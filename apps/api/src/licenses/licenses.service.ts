import { ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LicenseActivateResponse, LicenseTokenPayload, StoreLicenseDto } from '@pos/shared-types';
import type { Branch, License, Store } from '@prisma/client';
import type { KeyObject } from 'node:crypto';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateLicenseKey, loadPrivateKey, normalizeLicenseKey, signLicenseToken } from './license-tokens';
import type { ActivateDto } from './licenses.controller';

const DAY = 86_400_000;

export type LicenseWithStore = License & { store: Store & { branches: Branch[] } };

@Injectable()
export class LicensesService implements OnModuleInit {
  private key!: KeyObject;
  private tokenDays = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // Fail at boot, not at the first activation, if the key is missing or malformed.
    this.key = loadPrivateKey(this.config.getOrThrow<string>('LICENSE_PRIVATE_KEY'));
    this.tokenDays = Number(this.config.get('LICENSE_TOKEN_DAYS', 30)) || 30;
  }

  // ---------------------------------------------------------------- owner side (website)

  /** The store's active license, created on first request for stores made before Phase 5. */
  async forStore(ownerId: string, storeId: string): Promise<StoreLicenseDto> {
    await this.assertOwner(ownerId, storeId);
    let lic = await this.prisma.license.findFirst({
      where: { storeId, status: 'ACTIVE' },
      include: { activations: { orderBy: { lastSeenAt: 'desc' } } },
    });
    if (!lic) {
      lic = await this.prisma.license.create({
        data: { storeId, licenseKey: generateLicenseKey() },
        include: { activations: { orderBy: { lastSeenAt: 'desc' } } },
      });
    }
    return {
      licenseKey: lic.licenseKey,
      status: lic.status,
      createdAt: lic.createdAt.toISOString(),
      activations: lic.activations.map((a) => ({
        id: a.id,
        deviceName: a.deviceName,
        appVersion: a.appVersion,
        activatedAt: a.activatedAt.toISOString(),
        lastSeenAt: a.lastSeenAt.toISOString(),
      })),
    };
  }

  /** Replaces a leaked key: the old one stops working at the POS's next refresh. */
  async regenerate(ownerId: string, storeId: string): Promise<StoreLicenseDto> {
    await this.assertOwner(ownerId, storeId);
    await this.prisma.$transaction([
      this.prisma.license.updateMany({
        where: { storeId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      }),
      this.prisma.license.create({ data: { storeId, licenseKey: generateLicenseKey() } }),
    ]);
    return this.forStore(ownerId, storeId);
  }

  // ---------------------------------------------------------------- POS side (public endpoint)

  /**
   * Called by the POS on activation and on every refresh. Returns a signed token that
   * says which plan the store's owner has, valid until the sooner of LICENSE_TOKEN_DAYS
   * or the end of their Professional period.
   */
  async activate(dto: ActivateDto): Promise<LicenseActivateResponse> {
    const key = normalizeLicenseKey(dto.licenseKey);
    const lic = key
      ? await this.prisma.license.findUnique({
          where: { licenseKey: key },
          include: { store: { include: { branches: { orderBy: { createdAt: 'asc' } } } } },
        })
      : null;
    if (!lic) throw new NotFoundException('License key not found. Copy it again from your store page on the website.');
    if (lic.status !== 'ACTIVE') {
      throw new ForbiddenException('This license key was replaced. Use the current key from your store page.');
    }
    return this.issueFor(lic, dto);
  }

  /** The user's store license, creating the store/license if somehow missing (older accounts). */
  async licenseForUser(userId: string): Promise<LicenseWithStore> {
    const include = { store: { include: { branches: { orderBy: { createdAt: 'asc' as const } } } } };
    const existing = await this.prisma.license.findFirst({
      where: { status: 'ACTIVE', store: { ownerId: userId } },
      orderBy: { createdAt: 'asc' },
      include,
    });
    if (existing) return existing;
    const store =
      (await this.prisma.store.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' } })) ??
      (await this.prisma.store.create({
        data: { ownerId: userId, name: 'My Store', branches: { create: { name: 'Main', code: 'MAIN' } } },
      }));
    return this.prisma.license.create({ data: { storeId: store.id, licenseKey: generateLicenseKey() }, include });
  }

  /** Signs a license token for one POS install and records the activation. */
  async issueFor(
    lic: LicenseWithStore,
    device: { installId: string; deviceName?: string; appVersion?: string },
  ): Promise<LicenseActivateResponse> {
    const dto = device;
    const now = new Date();
    const [until] = await Promise.all([
      this.plans.professionalUntil(lic.store.ownerId),
      this.prisma.licenseActivation.upsert({
        where: { licenseId_installId: { licenseId: lic.id, installId: dto.installId } },
        create: { licenseId: lic.id, installId: dto.installId, deviceName: dto.deviceName, appVersion: dto.appVersion },
        update: { lastSeenAt: now, deviceName: dto.deviceName, appVersion: dto.appVersion },
      }),
    ]);

    const plan = until === undefined ? 'FREE' : 'PROFESSIONAL';
    let exp = now.getTime() + this.tokenDays * DAY;
    if (until) exp = Math.min(exp, until.getTime());

    const payload: LicenseTokenPayload = {
      lid: lic.id,
      sid: lic.storeId,
      uid: lic.store.ownerId,
      iid: dto.installId,
      plan,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(exp / 1000),
    };
    return {
      token: signLicenseToken(payload, this.key),
      plan,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      store: { id: lic.store.id, name: lic.store.name },
      branches: lic.store.branches.map((b) => ({ id: b.id, name: b.name, code: b.code })),
    };
  }

  private async assertOwner(ownerId: string, storeId: string) {
    const ok = await this.prisma.store.findFirst({ where: { id: storeId, ownerId }, select: { id: true } });
    if (!ok) throw new NotFoundException('Store not found');
  }
}

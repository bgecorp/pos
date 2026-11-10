import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PosConnectResponse, PosLinkCode } from '@pos/shared-types';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { addMonths } from '../subscriptions/upgrade-codes';
import { LicensesService } from './licenses.service';

interface DeviceInfo {
  installId: string;
  deviceName?: string;
  appVersion?: string;
}

const LINK_PURPOSE = 'pos-link';
const DEVICE_PURPOSE = 'pos-device';

/**
 * Connects a POS install to a website account without a license key:
 *  1. After login/register the website asks for a 5-minute link code and opens the POS with it.
 *  2. The POS server exchanges the code for a device token + signed license token.
 *  3. Later the POS uses the device token to refresh, subscribe and cancel.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly plans: PlansService,
    private readonly licenses: LicensesService,
  ) {}

  async linkCode(userId: string): Promise<PosLinkCode> {
    const code = await this.jwt.signAsync({ sub: userId, purpose: LINK_PURPOSE }, { expiresIn: '5m' });
    return { code, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  async connect(linkCode: string, device: DeviceInfo): Promise<PosConnectResponse> {
    const userId = await this.verify(linkCode, LINK_PURPOSE, 'This sign-in link expired. Open the POS from the website again.');
    const deviceToken = await this.jwt.signAsync(
      { sub: userId, purpose: DEVICE_PURPOSE, iid: device.installId },
      { expiresIn: '365d' },
    );
    return this.respond(userId, device, deviceToken);
  }

  async refresh(deviceToken: string, device: DeviceInfo): Promise<PosConnectResponse> {
    const userId = await this.verifyDevice(deviceToken, device.installId);
    return this.respond(userId, device, deviceToken);
  }

  /**
   * MVP/test mode: clicking Subscribe turns Professional on immediately for one month
   * (or adds a month), and records a PAID test payment so it shows in the admin page.
   * A real payment step would go here before the subscription is created.
   */
  async subscribe(deviceToken: string, device: DeviceInfo): Promise<PosConnectResponse> {
    const userId = await this.verifyDevice(deviceToken, device.installId);
    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const running = await tx.subscription.findFirst({
          where: { userId, status: 'ACTIVE', planCode: 'PROFESSIONAL', currentPeriodEnd: { gt: now } },
          orderBy: { currentPeriodEnd: 'desc' },
        });
        const sub = running
          ? await tx.subscription.update({
              where: { id: running.id },
              data: { currentPeriodEnd: addMonths(running.currentPeriodEnd!, 1) },
            })
          : await tx.subscription.create({
              data: { userId, planCode: 'PROFESSIONAL', status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd: addMonths(now, 1) },
            });
        const plan = await tx.plan.findUnique({ where: { code: 'PROFESSIONAL' } });
        await tx.payment.create({
          data: {
            userId,
            subscriptionId: sub.id,
            provider: 'pos-instant',
            amount: plan?.priceMonthly ?? 0,
            currency: plan?.currency ?? 'PHP',
            status: 'PAID',
            isTestMode: true,
            paidAt: now,
          },
        });
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    return this.respond(userId, device, deviceToken);
  }

  /** Ends Professional now. The POS falls back to Free; data is kept. */
  async cancel(deviceToken: string, device: DeviceInfo): Promise<PosConnectResponse> {
    const userId = await this.verifyDevice(deviceToken, device.installId);
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE', planCode: 'PROFESSIONAL' },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    return this.respond(userId, device, deviceToken);
  }

  private async respond(userId: string, device: DeviceInfo, deviceToken: string): Promise<PosConnectResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } });
    if (!user) throw new UnauthorizedException('This account no longer exists. Sign in again from the website.');
    const lic = await this.licenses.licenseForUser(userId);
    const [issued, until, plan] = await Promise.all([
      this.licenses.issueFor(lic, device),
      this.plans.professionalUntil(userId),
      this.prisma.plan.findUnique({ where: { code: 'PROFESSIONAL' } }),
    ]);
    return {
      ...issued,
      deviceToken,
      account: user,
      professionalUntil: until ? until.toISOString() : null,
      priceMonthly: plan?.priceMonthly ?? 0,
      currency: plan?.currency ?? 'PHP',
    };
  }

  private async verify(token: string, purpose: string, message: string): Promise<string> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; purpose?: string; iid?: string }>(token);
      if (p.purpose !== purpose) throw new Error('wrong purpose');
      return p.sub;
    } catch {
      throw new UnauthorizedException(message);
    }
  }

  private async verifyDevice(token: string, installId: string): Promise<string> {
    const message = 'This POS is signed out. Open it from the website to sign in again.';
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; purpose?: string; iid?: string }>(token);
      if (p.purpose !== DEVICE_PURPOSE || p.iid !== installId) throw new Error('mismatch');
      return p.sub;
    } catch {
      throw new UnauthorizedException(message);
    }
  }
}

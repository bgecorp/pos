import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FEATURES, hasFeature, PLAN_LIMITS } from '@pos/feature-entitlements';
import type { StoreDto } from '@pos/shared-types';
import type { Branch, Store } from '@prisma/client';
import { PlansService } from '../plans/plans.service';
import { generateLicenseKey } from '../licenses/license-tokens';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBranchDto, CreateStoreDto, UpdateStoreDto } from './dto';

const withBranches = { branches: { orderBy: { createdAt: 'asc' as const } } };

function toDto(s: Store & { branches: Branch[] }): StoreDto {
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    currency: s.currency,
    timezone: s.timezone,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    branches: s.branches.map((b) => ({ id: b.id, name: b.name, code: b.code, createdAt: b.createdAt.toISOString() })),
  };
}

/** Store metadata only. Sales/inventory never come here; they stay in each POS's SQLite. */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
  ) {}

  async list(ownerId: string): Promise<StoreDto[]> {
    const stores = await this.prisma.store.findMany({
      where: { ownerId },
      include: withBranches,
      orderBy: { createdAt: 'asc' },
    });
    return stores.map(toDto);
  }

  async get(ownerId: string, id: string): Promise<StoreDto> {
    return toDto(await this.findOwned(ownerId, id));
  }

  async create(ownerId: string, dto: CreateStoreDto): Promise<StoreDto> {
    const plan = await this.plans.effectivePlan(ownerId);
    const limit = PLAN_LIMITS[plan].stores;
    if (limit !== null) {
      const count = await this.prisma.store.count({ where: { ownerId } });
      if (count >= limit) {
        throw new ForbiddenException(
          `The ${plan === 'FREE' ? 'Free' : plan} plan allows ${limit} store${limit === 1 ? '' : 's'}. Upgrade to Professional for more.`,
        );
      }
    }
    // Every store starts with a "Main" branch and a license key for activating the POS.
    const store = await this.prisma.store.create({
      data: {
        ...dto,
        ownerId,
        branches: { create: { name: 'Main', code: 'MAIN' } },
        licenses: { create: { licenseKey: generateLicenseKey() } },
      },
      include: withBranches,
    });
    return toDto(store);
  }

  async update(ownerId: string, id: string, dto: UpdateStoreDto): Promise<StoreDto> {
    await this.findOwned(ownerId, id);
    const store = await this.prisma.store.update({ where: { id }, data: dto, include: withBranches });
    return toDto(store);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.findOwned(ownerId, id);
    await this.prisma.store.delete({ where: { id } });
  }

  async addBranch(ownerId: string, storeId: string, dto: CreateBranchDto): Promise<StoreDto> {
    const store = await this.findOwned(ownerId, storeId);
    const plan = await this.plans.effectivePlan(ownerId);
    if (store.branches.length >= 1 && !hasFeature(plan, FEATURES.MULTI_BRANCH)) {
      throw new ForbiddenException('Multiple branches require the Professional plan.');
    }
    if (store.branches.some((b) => b.code === dto.code)) {
      throw new ConflictException(`Branch code ${dto.code} is already used in this store`);
    }
    await this.prisma.branch.create({ data: { ...dto, storeId } });
    return this.get(ownerId, storeId);
  }

  async removeBranch(ownerId: string, storeId: string, branchId: string): Promise<StoreDto> {
    const store = await this.findOwned(ownerId, storeId);
    if (!store.branches.some((b) => b.id === branchId)) throw new NotFoundException('Branch not found');
    if (store.branches.length === 1) throw new BadRequestException('A store must keep at least one branch');
    await this.prisma.branch.delete({ where: { id: branchId } });
    return this.get(ownerId, storeId);
  }

  /** 404 (not 403) for other people's stores, so ids can't be probed. */
  private async findOwned(ownerId: string, id: string) {
    const store = await this.prisma.store.findFirst({ where: { id, ownerId }, include: withBranches });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }
}

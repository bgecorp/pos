import { Injectable } from '@nestjs/common';
import { featuresFor, PLAN_LIMITS } from '@pos/feature-entitlements';
import type { PlanCode, PlanDto } from '@pos/shared-types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PlanDto[]> {
    const plans = await this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthly: 'asc' } });
    return plans.map((p) => ({
      code: p.code,
      name: p.name,
      priceMonthly: p.priceMonthly,
      currency: p.currency,
      features: [...featuresFor(p.code)],
      limits: PLAN_LIMITS[p.code],
    }));
  }

  /**
   * The plan a user is entitled to right now. No active, unexpired PROFESSIONAL
   * subscription means FREE. This is the single place plan status is decided.
   */
  async effectivePlan(userId: string): Promise<PlanCode> {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        planCode: 'PROFESSIONAL',
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }],
      },
      select: { id: true },
    });
    return sub ? 'PROFESSIONAL' : 'FREE';
  }

  /**
   * When the user's Professional access ends: a Date, `null` for no end date,
   * or `undefined` when they are not on Professional now.
   */
  async professionalUntil(userId: string): Promise<Date | null | undefined> {
    const subs = await this.prisma.subscription.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        planCode: 'PROFESSIONAL',
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }],
      },
      select: { currentPeriodEnd: true },
    });
    if (subs.length === 0) return undefined;
    if (subs.some((s) => s.currentPeriodEnd === null)) return null;
    return new Date(Math.max(...subs.map((s) => s.currentPeriodEnd!.getTime())));
  }
}

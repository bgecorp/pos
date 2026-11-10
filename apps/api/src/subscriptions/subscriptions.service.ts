import { BadRequestException, Injectable } from '@nestjs/common';
import type { PaymentDto, RedeemResult, SubscriptionDto, SubscriptionOverview } from '@pos/shared-types';
import type { Payment, Subscription, UpgradeCode } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { addMonths, normalizeCode } from './upgrade-codes';

export function toPaymentDto(p: Payment & { upgradeCode?: Pick<UpgradeCode, 'months'> | null }): PaymentDto {
  const months = p.upgradeCode?.months;
  return {
    id: p.id,
    provider: p.provider,
    reference: p.providerReference,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    description:
      p.provider === 'code' && months
        ? `Professional · ${months} month${months === 1 ? '' : 's'} · upgrade code`
        : p.provider === 'pos-instant'
          ? `Professional · 1 month · subscribed in POS${p.isTestMode ? ' (test, no payment)' : ''}`
          : `Professional · ${p.provider}`,
  };
}

function toSubscriptionDto(s: Subscription, now: Date): SubscriptionDto {
  return {
    id: s.id,
    planCode: s.planCode,
    status: s.status,
    currentPeriodStart: s.currentPeriodStart.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
    isCurrent: s.status === 'ACTIVE' && (!s.currentPeriodEnd || s.currentPeriodEnd > now),
  };
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly auth: AuthService,
  ) {}

  async overview(userId: string): Promise<SubscriptionOverview> {
    const now = new Date();
    const [subs, payments] = await Promise.all([
      this.prisma.subscription.findMany({ where: { userId }, orderBy: { currentPeriodStart: 'desc' } }),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { upgradeCode: { select: { months: true } } },
      }),
    ]);
    const dtos = subs.map((s) => toSubscriptionDto(s, now));
    const pro = dtos.filter((s) => s.isCurrent && s.planCode === 'PROFESSIONAL');
    const until = pro.some((s) => !s.currentPeriodEnd)
      ? null
      : (pro.map((s) => s.currentPeriodEnd!).sort().pop() ?? null);
    return {
      plan: pro.length ? 'PROFESSIONAL' : 'FREE',
      professionalUntil: until,
      subscriptions: dtos,
      payments: payments.map(toPaymentDto),
    };
  }

  /**
   * Redeems an upgrade code: marks it used, starts or extends Professional, and records
   * the payment. Everything happens in one transaction; the conditional update makes a
   * code impossible to redeem twice even with two simultaneous requests.
   */
  async redeem(userId: string, rawCode: string): Promise<RedeemResult> {
    const code = normalizeCode(rawCode);
    const invalid = new BadRequestException('That code is not valid. Check it and try again.');
    if (!code) throw invalid;

    const { months, end } = await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.upgradeCode.findUnique({ where: { code } });
        if (!row || row.status === 'REVOKED') throw invalid;
        if (row.status === 'REDEEMED') throw new BadRequestException('That code has already been used.');
        const now = new Date();
        const claimed = await tx.upgradeCode.updateMany({
          where: { id: row.id, status: 'UNUSED' },
          data: { status: 'REDEEMED', redeemedById: userId, redeemedAt: now },
        });
        if (claimed.count !== 1) throw new BadRequestException('That code has already been used.');

        // Stack on top of a running Professional period instead of overlapping it.
        const running = await tx.subscription.findFirst({
          where: { userId, status: 'ACTIVE', planCode: row.planCode, currentPeriodEnd: { gt: now } },
          orderBy: { currentPeriodEnd: 'desc' },
        });
        const sub = running
          ? await tx.subscription.update({
              where: { id: running.id },
              data: { currentPeriodEnd: addMonths(running.currentPeriodEnd!, row.months) },
            })
          : await tx.subscription.create({
              data: {
                userId,
                planCode: row.planCode,
                status: 'ACTIVE',
                currentPeriodStart: now,
                currentPeriodEnd: addMonths(now, row.months),
              },
            });

        const plan = await tx.plan.findUnique({ where: { code: row.planCode } });
        const payment = await tx.payment.create({
          data: {
            userId,
            subscriptionId: sub.id,
            provider: 'code',
            providerReference: code,
            amount: (plan?.priceMonthly ?? 0) * row.months,
            currency: plan?.currency ?? 'PHP',
            status: 'PAID',
            isTestMode: false,
            paidAt: now,
          },
        });
        await tx.upgradeCode.update({ where: { id: row.id }, data: { paymentId: payment.id } });
        return { months: row.months, end: sub.currentPeriodEnd! };
      },
      // Supabase is ~150 ms away per round trip; give the 7 statements room.
      { timeout: 20_000, maxWait: 10_000 },
    );

    return { months, professionalUntil: end.toISOString(), user: await this.auth.me(userId) };
  }
}

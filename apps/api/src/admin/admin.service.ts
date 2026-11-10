import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCustomer, AdminOverview, AdminPayment, UpgradeCodeDto, UpgradeCodeStatus } from '@pos/shared-types';
import type { UpgradeCode, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toPaymentDto } from '../subscriptions/subscriptions.service';
import { generateCode } from '../subscriptions/upgrade-codes';

const DAY = 86_400_000;
const activePro = (now: Date) => ({
  status: 'ACTIVE' as const,
  planCode: 'PROFESSIONAL' as const,
  OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
});
const who = (u: Pick<User, 'id' | 'email' | 'fullName'>) => ({ id: u.id, email: u.email, fullName: u.fullName });

function toCodeDto(c: UpgradeCode & { redeemedBy: Pick<User, 'id' | 'email' | 'fullName'> | null }): UpgradeCodeDto {
  return {
    id: c.id,
    code: c.code,
    months: c.months,
    status: c.status,
    note: c.note,
    createdAt: c.createdAt.toISOString(),
    redeemedAt: c.redeemedAt?.toISOString() ?? null,
    redeemedBy: c.redeemedBy ? who(c.redeemedBy) : null,
  };
}

const redeemedBySelect = { redeemedBy: { select: { id: true, email: true, fullName: true } } };

/** Owner-only views. Reads SaaS data only: no customer POS sales ever reach this database. */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<AdminOverview> {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY);
    const [customers, newCustomers30d, pro, total, last30, unusedCodes] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.subscription.findMany({ where: activePro(now), select: { userId: true }, distinct: ['userId'] }),
      this.prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: since } }, _sum: { amount: true } }),
      this.prisma.upgradeCode.count({ where: { status: 'UNUSED' } }),
    ]);
    return {
      customers,
      newCustomers30d,
      activeProfessional: pro.length,
      revenueTotal: total._sum.amount ?? 0,
      revenue30d: last30._sum.amount ?? 0,
      unusedCodes,
      currency: 'PHP',
    };
  }

  async customers(search?: string): Promise<AdminCustomer[]> {
    const now = new Date();
    const q = search?.trim();
    const users = await this.prisma.user.findMany({
      where: q
        ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { fullName: { contains: q, mode: 'insensitive' } }] }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        _count: { select: { stores: true } },
        subscriptions: { where: activePro(now), orderBy: { currentPeriodEnd: 'desc' } },
        payments: { where: { status: 'PAID' }, select: { amount: true } },
      },
    });
    return users.map((u) => {
      const pro = u.subscriptions;
      return {
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
        plan: pro.length ? 'PROFESSIONAL' : 'FREE',
        professionalUntil: pro.some((s) => !s.currentPeriodEnd) ? null : (pro[0]?.currentPeriodEnd?.toISOString() ?? null),
        stores: u._count.stores,
        totalPaid: u.payments.reduce((a, p) => a + p.amount, 0),
      };
    });
  }

  async payments(): Promise<AdminPayment[]> {
    const rows = await this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { user: { select: { id: true, email: true, fullName: true } }, upgradeCode: { select: { months: true } } },
    });
    return rows.map((p) => ({ ...toPaymentDto(p), customer: who(p.user) }));
  }

  async codes(status?: UpgradeCodeStatus): Promise<UpgradeCodeDto[]> {
    const rows = await this.prisma.upgradeCode.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: redeemedBySelect,
    });
    return rows.map(toCodeDto);
  }

  async createCodes(adminId: string, count: number, months: number, note?: string): Promise<UpgradeCodeDto[]> {
    const codes = new Set<string>();
    while (codes.size < count) codes.add(generateCode());
    // A collision with an existing code is astronomically unlikely; skipDuplicates keeps it harmless.
    await this.prisma.upgradeCode.createMany({
      data: [...codes].map((code) => ({ code, months, note: note?.trim() || null, createdById: adminId })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.upgradeCode.findMany({
      where: { code: { in: [...codes] } },
      orderBy: { code: 'asc' },
      include: redeemedBySelect,
    });
    return rows.map(toCodeDto);
  }

  async revokeCode(id: string): Promise<UpgradeCodeDto> {
    const r = await this.prisma.upgradeCode.updateMany({ where: { id, status: 'UNUSED' }, data: { status: 'REVOKED' } });
    if (r.count === 0) {
      const exists = await this.prisma.upgradeCode.findUnique({ where: { id }, select: { status: true } });
      if (!exists) throw new NotFoundException('Code not found');
      throw new BadRequestException(`Only unused codes can be revoked (this one is ${exists.status.toLowerCase()})`);
    }
    return toCodeDto(await this.prisma.upgradeCode.findUniqueOrThrow({ where: { id }, include: redeemedBySelect }));
  }
}

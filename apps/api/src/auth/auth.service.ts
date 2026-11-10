import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { featuresFor } from '@pos/feature-entitlements';
import type { AuthResponse, AuthUser } from '@pos/shared-types';
import { generateLicenseKey } from '../licenses/license-tokens';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ChangePasswordDto, LoginDto, RegisterDto, UpdateAccountDto } from './dto';
import type { JwtPayload } from './jwt-auth.guard';
import { hashPassword, verifyPassword } from './password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly plans: PlansService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } });
    if (exists) throw new ConflictException('An account with this email already exists');
    // Every account starts with its store (Main branch + license) so the POS works right away.
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        passwordHash: await hashPassword(dto.password),
        stores: {
          create: {
            name: `${dto.fullName.split(' ')[0]}'s Store`.slice(0, 100),
            branches: { create: { name: 'Main', code: 'MAIN' } },
            licenses: { create: { licenseKey: generateLicenseKey() } },
          },
        },
      },
    });
    return this.issue(user.id, user.email);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Same message for unknown email and wrong password: don't reveal which accounts exist.
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect email or password');
    }
    return this.issue(user.id, user.email);
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    const plan = await this.plans.effectivePlan(user.id);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      createdAt: user.createdAt.toISOString(),
      plan,
      features: [...featuresFor(plan)],
      role: user.role,
    };
  }

  async updateAccount(userId: string, dto: UpdateAccountDto): Promise<AuthUser> {
    await this.prisma.user.update({ where: { id: userId }, data: { fullName: dto.fullName } });
    return this.me(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    if (!(await verifyPassword(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(dto.newPassword) },
    });
  }

  private async issue(userId: string, email: string): Promise<AuthResponse> {
    const payload: JwtPayload = { sub: userId, email };
    return { accessToken: await this.jwt.signAsync(payload), user: await this.me(userId) };
  }
}

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtAuthGuard, type RequestUser } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Valid JWT + role ADMIN. The role is read from the database on every request
 * (not from the token), so demoting an admin takes effect immediately.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwtGuard: JwtAuthGuard,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await this.jwtGuard.canActivate(ctx);
    const { user } = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
    const row = await this.prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
    if (row?.role !== 'ADMIN') throw new ForbiddenException('Admins only');
    return true;
  }
}

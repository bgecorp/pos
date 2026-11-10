import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthResponse, AuthUser } from '@pos/shared-types';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateAccountDto } from './dto';
import { CurrentUser, JwtAuthGuard, type RequestUser } from './jwt-auth.guard';

// Tighter limit on credential endpoints: 10 attempts / minute / IP.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(AUTH_THROTTLE)
  @Post('auth/register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @Post('auth/login')
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  // Logout is client-side for the MVP: tokens are stateless and short-lived (JWT_EXPIRES_IN).

  @UseGuards(JwtAuthGuard)
  @Get('auth/me')
  me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.me(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('account')
  updateAccount(@CurrentUser() user: RequestUser, @Body() dto: UpdateAccountDto): Promise<AuthUser> {
    return this.auth.updateAccount(user.id, dto);
  }

  @Throttle(AUTH_THROTTLE)
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post('account/password')
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto): Promise<void> {
    return this.auth.changePassword(user.id, dto);
  }
}

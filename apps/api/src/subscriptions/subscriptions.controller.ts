import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RedeemResult, SubscriptionOverview } from '@pos/shared-types';
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser, JwtAuthGuard, type RequestUser } from '../auth/jwt-auth.guard';
import { SubscriptionsService } from './subscriptions.service';

class RedeemDto {
  @IsString()
  @MaxLength(32)
  code: string;
}

@UseGuards(JwtAuthGuard)
@Controller('subscription')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  /** Current plan, subscription periods and payment history of the signed-in user. */
  @Get()
  overview(@CurrentUser() u: RequestUser): Promise<SubscriptionOverview> {
    return this.subs.overview(u.id);
  }

  // 5 attempts / minute / IP: makes guessing codes impractical.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('redeem')
  redeem(@CurrentUser() u: RequestUser, @Body() dto: RedeemDto): Promise<RedeemResult> {
    return this.subs.redeem(u.id, dto.code);
  }
}

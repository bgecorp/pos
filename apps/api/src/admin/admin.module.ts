import { Module } from '@nestjs/common';
import { SubscriptionsController } from '../subscriptions/subscriptions.controller';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

/** Subscriptions (customer side) and admin (owner side) share the upgrade-code logic. */
@Module({
  controllers: [SubscriptionsController, AdminController],
  providers: [SubscriptionsService, AdminService, AdminGuard],
})
export class BillingModule {}

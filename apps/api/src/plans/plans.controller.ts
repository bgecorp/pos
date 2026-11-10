import { Controller, Get } from '@nestjs/common';
import type { PlanDto } from '@pos/shared-types';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** Public: used by the pricing page. */
  @Get()
  list(): Promise<PlanDto[]> {
    return this.plans.list();
  }
}

import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@pos/shared-types';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const dbUp = await this.prisma.isHealthy();
    return {
      status: dbUp ? 'ok' : 'degraded',
      service: 'saas-pos-api',
      version: '0.1.0',
      database: dbUp ? 'up' : 'down',
      time: new Date().toISOString(),
    };
  }
}

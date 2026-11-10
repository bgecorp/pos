import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import type { AdminCustomer, AdminOverview, AdminPayment, UpgradeCodeDto } from '@pos/shared-types';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, type RequestUser } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

class CreateCodesDto {
  @IsInt()
  @Min(1)
  @Max(50)
  count: number;

  @IsInt()
  @Min(1, { message: 'Months must be at least 1' })
  @Max(24, { message: 'Months must be at most 24' })
  months: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;
}

class CodesQuery {
  @IsOptional()
  @IsIn(['UNUSED', 'REDEEMED', 'REVOKED'])
  status?: 'UNUSED' | 'REDEEMED' | 'REVOKED';
}

class CustomersQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(): Promise<AdminOverview> {
    return this.admin.overview();
  }

  @Get('customers')
  customers(@Query() q: CustomersQuery): Promise<AdminCustomer[]> {
    return this.admin.customers(q.search);
  }

  @Get('payments')
  payments(): Promise<AdminPayment[]> {
    return this.admin.payments();
  }

  @Get('codes')
  codes(@Query() q: CodesQuery): Promise<UpgradeCodeDto[]> {
    return this.admin.codes(q.status);
  }

  @Post('codes')
  createCodes(@CurrentUser() u: RequestUser, @Body() dto: CreateCodesDto): Promise<UpgradeCodeDto[]> {
    return this.admin.createCodes(u.id, dto.count, dto.months, dto.note);
  }

  @Post('codes/:id/revoke')
  revoke(@Param('id', ParseUUIDPipe) id: string): Promise<UpgradeCodeDto> {
    return this.admin.revokeCode(id);
  }
}

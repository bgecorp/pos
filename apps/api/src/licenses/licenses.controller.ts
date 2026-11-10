import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { LicenseActivateResponse, StoreLicenseDto } from '@pos/shared-types';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser, JwtAuthGuard, type RequestUser } from '../auth/jwt-auth.guard';
import { LicensesService } from './licenses.service';

export class ActivateDto {
  @IsString()
  @MaxLength(40)
  licenseKey: string;

  @IsUUID('4', { message: 'Invalid install id' })
  installId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  appVersion?: string;
}

@Controller()
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  /** Store owner: see / copy the key and which POS installs use it. */
  @UseGuards(JwtAuthGuard)
  @Get('stores/:id/license')
  get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<StoreLicenseDto> {
    return this.licenses.forStore(u.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('stores/:id/license/regenerate')
  regenerate(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<StoreLicenseDto> {
    return this.licenses.regenerate(u.id, id);
  }

  /**
   * Public: called by the POS with the license key (the key is the credential).
   * 20/min/IP keeps key guessing impractical while allowing normal refreshes.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('licenses/activate')
  activate(@Body() dto: ActivateDto): Promise<LicenseActivateResponse> {
    return this.licenses.activate(dto);
  }
}

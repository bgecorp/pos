import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { PosConnectResponse, PosLinkCode } from '@pos/shared-types';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser, JwtAuthGuard, type RequestUser } from '../auth/jwt-auth.guard';
import { PosService } from './pos.service';

class DeviceDto {
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

class ConnectDto extends DeviceDto {
  @IsString()
  @MaxLength(2000)
  linkCode: string;
}

const bearer = (h?: string) => {
  const [scheme, token] = (h ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('This POS is signed out.');
  return token;
};

@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  /** Website, signed in: a 5-minute code to open the POS already signed in. */
  @UseGuards(JwtAuthGuard)
  @Post('link-code')
  linkCode(@CurrentUser() u: RequestUser): Promise<PosLinkCode> {
    return this.pos.linkCode(u.id);
  }

  /** POS server: exchange the link code for a device token + license. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('connect')
  connect(@Body() dto: ConnectDto): Promise<PosConnectResponse> {
    return this.pos.connect(dto.linkCode, dto);
  }

  @HttpCode(200)
  @Post('refresh')
  refresh(@Headers('authorization') auth: string, @Body() dto: DeviceDto): Promise<PosConnectResponse> {
    return this.pos.refresh(bearer(auth), dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('subscribe')
  subscribe(@Headers('authorization') auth: string, @Body() dto: DeviceDto): Promise<PosConnectResponse> {
    return this.pos.subscribe(bearer(auth), dto);
  }

  @HttpCode(200)
  @Post('cancel')
  cancel(@Headers('authorization') auth: string, @Body() dto: DeviceDto): Promise<PosConnectResponse> {
    return this.pos.cancel(bearer(auth), dto);
  }
}

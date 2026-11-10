import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { StoreDto } from '@pos/shared-types';
import { CurrentUser, JwtAuthGuard, type RequestUser } from '../auth/jwt-auth.guard';
import { CreateBranchDto, CreateStoreDto, UpdateStoreDto } from './dto';
import { StoresService } from './stores.service';

@UseGuards(JwtAuthGuard)
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  list(@CurrentUser() u: RequestUser): Promise<StoreDto[]> {
    return this.stores.list(u.id);
  }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateStoreDto): Promise<StoreDto> {
    return this.stores.create(u.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<StoreDto> {
    return this.stores.get(u.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() u: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreDto,
  ): Promise<StoreDto> {
    return this.stores.update(u.id, id, dto);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.stores.remove(u.id, id);
  }

  @Post(':id/branches')
  addBranch(
    @CurrentUser() u: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBranchDto,
  ): Promise<StoreDto> {
    return this.stores.addBranch(u.id, id, dto);
  }

  @Delete(':id/branches/:branchId')
  removeBranch(
    @CurrentUser() u: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<StoreDto> {
    return this.stores.removeBranch(u.id, id, branchId);
  }
}

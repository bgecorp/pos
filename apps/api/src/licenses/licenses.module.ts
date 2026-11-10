import { Module } from '@nestjs/common';
import { LicensesController } from './licenses.controller';
import { LicensesService } from './licenses.service';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  controllers: [LicensesController, PosController],
  providers: [LicensesService, PosService],
})
export class LicensesModule {}

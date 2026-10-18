import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { PaginationQuery } from '../../common/pagination';
import { AdjustStockDto, BatchQuery, BatchStatusDto, CreateCountDto, MovementQuery, RejectCountDto } from './inventory.dto';
import { InventoryService } from './inventory.service';
import { RiskService } from './risk.service';
import { StockLedgerService } from './stock-ledger.service';

class CountQuery extends PaginationQuery {
  @IsOptional() @IsString() status?: string;
}
class ExpiryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(730) withinDays?: number;
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly risk: RiskService,
  ) {}

  @Get('summary')
  @RequirePermissions('inventory.read')
  summary() {
    return this.service.summary();
  }

  @Get('batches')
  @RequirePermissions('inventory.read')
  batches(@Query() query: BatchQuery) {
    return this.service.listBatches(query);
  }

  @Get('batches/:id')
  @RequirePermissions('inventory.read')
  batch(@Param('id') id: string) {
    return this.service.getBatch(id);
  }

  @Patch('batches/:id/status')
  @RequirePermissions('inventory.adjust')
  batchStatus(@Param('id') id: string, @Body() dto: BatchStatusDto, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.setBatchStatus(id, dto, actor, rid);
  }

  @Get('movements')
  @RequirePermissions('inventory.read')
  movements(@Query() query: MovementQuery) {
    return this.service.listMovements(query);
  }

  @Post('adjustments')
  @RequirePermissions('inventory.adjust')
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.adjust(dto, actor, rid);
  }

  @Get('counts')
  @RequirePermissions('inventory.read')
  counts(@Query() query: CountQuery) {
    return this.service.listCounts(query);
  }

  @Get('counts/:id')
  @RequirePermissions('inventory.read')
  count(@Param('id') id: string) {
    return this.service.getCount(id);
  }

  @Post('counts')
  @RequirePermissions('inventory.count')
  createCount(@Body() dto: CreateCountDto, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.createCount(dto, actor, rid);
  }

  @Post('counts/:id/submit')
  @RequirePermissions('inventory.count')
  submitCount(@Param('id') id: string, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.submitCount(id, actor, rid);
  }

  @Post('counts/:id/approve')
  @RequirePermissions('inventory.count.approve')
  approveCount(@Param('id') id: string, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.approveCount(id, actor, rid);
  }

  @Post('counts/:id/reject')
  @RequirePermissions('inventory.count.approve')
  rejectCount(@Param('id') id: string, @Body() dto: RejectCountDto, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.rejectCount(id, dto, actor, rid);
  }

  @Get('expiry-risk')
  @ApiQuery({ name: 'withinDays', required: false })
  @RequirePermissions('inventory.read')
  expiryRisk(@Query() q: ExpiryQuery) {
    return this.risk.expiryRisk(q.withinDays ?? 180);
  }

  @Get('stockout-risk')
  @RequirePermissions('inventory.read')
  stockoutRisk() {
    return this.risk.stockoutRisk();
  }
}

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockLedgerService, RiskService],
  exports: [InventoryService, StockLedgerService, RiskService],
})
export class InventoryModule {}

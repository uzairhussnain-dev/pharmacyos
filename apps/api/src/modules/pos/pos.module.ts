import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { CashSessionsModule } from '../cash-sessions/cash-sessions.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CheckoutDto, HoldCartDto, QuoteDto } from './pos.dto';
import { PosService } from './pos.service';

@ApiTags('pos')
@ApiBearerAuth()
@Controller('pos')
export class PosController {
  constructor(private readonly service: PosService) {}

  @Post('sales/quote')
  @HttpCode(200)
  @RequirePermissions('pos.sell')
  @ApiOperation({ summary: 'Advisory pricing + availability. Does not reserve stock.' })
  quote(@Body() dto: QuoteDto, @CurrentUser() a: AuthUser) {
    return this.service.quote(dto, a);
  }

  @Post('sales')
  @RequirePermissions('pos.sell')
  @ApiOperation({ summary: 'Idempotent transactional checkout. Requires an open cash session.' })
  checkout(@Body() dto: CheckoutDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.checkout(dto, a, r);
  }

  @Get('held')
  @RequirePermissions('pos.sell')
  listHeld(@CurrentUser() a: AuthUser) {
    return this.service.listHeld(a);
  }

  @Post('held')
  @RequirePermissions('pos.sell')
  hold(@Body() dto: HoldCartDto, @CurrentUser() a: AuthUser) {
    return this.service.hold(dto, a);
  }

  @Delete('held/:id')
  @RequirePermissions('pos.sell')
  release(@Param('id') id: string, @CurrentUser() a: AuthUser) {
    return this.service.releaseHeld(id, a);
  }
}

@Module({
  imports: [InventoryModule, CashSessionsModule, CustomersModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}

import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { InventoryModule } from '../inventory/inventory.module';
import {
  CreatePurchaseOrderDto,
  CreatePurchaseReturnDto,
  DirectReceiveDto,
  PoQuery,
  ReceiveDto,
  SupplierPaymentDto,
  UpdatePurchaseOrderDto,
} from './purchasing.dto';
import { PurchasingService } from './purchasing.service';

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller()
export class PurchasingController {
  constructor(private readonly service: PurchasingService) {}

  @Get('purchase-orders') @RequirePermissions('purchasing.read')
  listOrders(@Query() q: PoQuery) {
    return this.service.listOrders(q);
  }
  @Post('purchase-orders') @RequirePermissions('purchasing.write')
  createOrder(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.createOrder(dto, a, r);
  }
  @Get('purchase-orders/:id') @RequirePermissions('purchasing.read')
  getOrder(@Param('id') id: string) {
    return this.service.getOrder(id);
  }
  @Patch('purchase-orders/:id') @RequirePermissions('purchasing.write')
  updateOrder(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.updateOrder(id, dto, a, r);
  }
  @Post('purchase-orders/:id/submit') @RequirePermissions('purchasing.write')
  submitOrder(@Param('id') id: string, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.submitOrder(id, a, r);
  }
  @Post('purchase-orders/:id/receive') @RequirePermissions('purchasing.receive')
  receive(@Param('id') id: string, @Body() dto: ReceiveDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.receiveOrder(id, dto, a, r);
  }

  @Get('goods-receipts') @RequirePermissions('purchasing.read')
  listReceipts(@Query() q: PoQuery) {
    return this.service.listReceipts(q);
  }
  @Post('goods-receipts') @RequirePermissions('purchasing.receive')
  receiveDirect(@Body() dto: DirectReceiveDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.receiveDirect(dto, a, r);
  }
  @Get('goods-receipts/:id') @RequirePermissions('purchasing.read')
  getReceipt(@Param('id') id: string) {
    return this.service.getReceipt(id);
  }
  @Post('supplier-payments') @RequirePermissions('finance.read', 'purchasing.write')
  pay(@Body() dto: SupplierPaymentDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.paySupplier(dto, a, r);
  }

  @Get('purchase-returns') @RequirePermissions('purchasing.read')
  listReturns(@Query() q: PoQuery) {
    return this.service.listReturns(q);
  }
  @Post('purchase-returns') @RequirePermissions('purchasing.return')
  createReturn(@Body() dto: CreatePurchaseReturnDto, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.createReturn(dto, a, r);
  }
  @Post('purchase-returns/:id/finalize') @RequirePermissions('purchasing.return')
  finalizeReturn(@Param('id') id: string, @CurrentUser() a: AuthUser, @RequestId() r: string) {
    return this.service.finalizeReturn(id, a, r);
  }
}

@Module({ imports: [InventoryModule], controllers: [PurchasingController], providers: [PurchasingService], exports: [PurchasingService] })
export class PurchasingModule {}

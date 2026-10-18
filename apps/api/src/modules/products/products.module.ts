import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { CreateProductDto, ProductQuery, UpdateProductDto } from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @RequirePermissions('products.read')
  list(@Query() query: ProductQuery) {
    return this.service.list(query);
  }

  @Get('categories')
  @RequirePermissions('products.read')
  categories() {
    return this.service.categories();
  }

  @Get('lookup')
  @ApiQuery({ name: 'barcode', required: true })
  @RequirePermissions('products.read')
  lookup(@Query('barcode') barcode: string) {
    return this.service.lookup(barcode ?? '');
  }

  @Get('search')
  @ApiQuery({ name: 'q', required: true })
  @RequirePermissions('products.read')
  search(@Query('q') q: string) {
    return this.service.search(q ?? '');
  }

  @Get(':id')
  @RequirePermissions('products.read')
  get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @RequirePermissions('products.write')
  create(@Body() dto: CreateProductDto, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.create(dto, actor, rid);
  }

  @Patch(':id')
  @RequirePermissions('products.write')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.update(id, dto, actor, rid);
  }
}

@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}

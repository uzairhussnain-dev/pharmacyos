import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuthUser } from '../../common/decorators';
import { ConflictError, ErrorCodes, NotFoundError } from '../../common/errors';
import { escapeRegex, paginate } from '../../common/pagination';
import { Product, ProductDocument } from '../../database/schemas/product.schema';
import { AuditService } from '../audit/audit.module';
import { CreateProductDto, ProductQuery, UpdateProductDto } from './products.dto';

export function toProductDto(p: Product & { _id: Types.ObjectId }) {
  return {
    id: p._id.toString(),
    sku: p.sku,
    barcode: p.barcode,
    brandName: p.brandName,
    genericName: p.genericName,
    strength: p.strength,
    dosageForm: p.dosageForm,
    route: p.route,
    manufacturer: p.manufacturer,
    registrationNumber: p.registrationNumber,
    category: p.category,
    baseUnit: p.baseUnit,
    packUnits: p.packUnits ?? [],
    sellingPriceMinor: p.sellingPriceMinor,
    taxClass: p.taxClass,
    taxRateBps: p.taxRateBps,
    saleRestriction: p.saleRestriction,
    requiresPrescription: p.requiresPrescription,
    isActive: p.isActive,
    tracksExpiry: p.tracksExpiry,
    reorderLevel: p.reorderLevel,
    reorderQuantity: p.reorderQuantity,
    leadTimeDays: p.leadTimeDays,
    onHandUnits: p.onHandUnits,
    eligibleUnits: p.eligibleUnits,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    private readonly audit: AuditService,
  ) {}

  async list(query: ProductQuery) {
    const filter: FilterQuery<ProductDocument> = {};
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ brandName: rx }, { genericName: rx }, { sku: rx }, { barcode: query.q.trim() }];
    }
    if (query.category) filter.category = query.category;
    if (query.isActive) filter.isActive = query.isActive === 'true';
    if (query.lowStock === 'true') filter.$expr = { $lte: ['$eligibleUnits', '$reorderLevel'] };
    const sort: Record<string, 1 | -1> =
      query.sort === 'sku'
        ? { sku: 1 }
        : query.sort === 'stock'
          ? { eligibleUnits: 1 }
          : query.sort === 'updated'
            ? { updatedAt: -1 }
            : { brandName: 1 };
    const [items, total] = await Promise.all([
      this.products.find(filter).sort(sort).skip(query.skip).limit(query.pageSize).lean(),
      this.products.countDocuments(filter),
    ]);
    return paginate(items.map(toProductDto), total, query);
  }

  async categories(): Promise<string[]> {
    return this.products.distinct('category');
  }

  async getById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Product', id);
    const p = await this.products.findById(id).lean();
    if (!p) throw new NotFoundError('Product', id);
    return toProductDto(p);
  }

  /** Exact lookup used by POS scanners: product barcode, pack barcode, or SKU. */
  async lookup(code: string) {
    const trimmed = code.trim();
    if (!trimmed) throw new NotFoundError('Product');
    const p = await this.products
      .findOne({
        isActive: true,
        $or: [{ barcode: trimmed }, { 'packUnits.barcode': trimmed }, { sku: trimmed.toUpperCase() }],
      })
      .lean();
    if (!p) throw new NotFoundError('Product', trimmed);
    const matchedPack = p.packUnits?.find((u) => u.barcode === trimmed);
    return { product: toProductDto(p), matchedPackUnit: matchedPack?.name };
  }

  /** Fast search for POS (limit 15). */
  async search(q: string) {
    const term = q.trim();
    if (term.length < 2) return [];
    const rx = new RegExp(escapeRegex(term), 'i');
    const items = await this.products
      .find({ isActive: true, $or: [{ brandName: rx }, { genericName: rx }, { sku: rx }] })
      .sort({ brandName: 1 })
      .limit(15)
      .lean();
    return items.map(toProductDto);
  }

  async create(dto: CreateProductDto, actor: AuthUser, requestId: string) {
    await this.assertUnique(dto.sku, dto.barcode, dto.packUnits?.map((u) => u.barcode));
    const product = await this.products.create({ ...dto, sku: dto.sku.toUpperCase(), barcode: dto.barcode || undefined });
    await this.audit.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'product.create',
      entityType: 'Product',
      entityId: product._id,
      after: toProductDto(product.toObject()),
      requestId,
    });
    return toProductDto(product.toObject());
  }

  async update(id: string, dto: UpdateProductDto, actor: AuthUser, requestId: string) {
    const product = await this.products.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    await this.assertUnique(dto.sku, dto.barcode, dto.packUnits?.map((u) => u.barcode), product._id);
    const before = toProductDto(product.toObject());
    Object.assign(product, dto, dto.sku ? { sku: dto.sku.toUpperCase() } : {});
    if (dto.barcode === '') product.barcode = undefined;
    await product.save();
    await this.audit.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'product.update',
      entityType: 'Product',
      entityId: product._id,
      before,
      after: toProductDto(product.toObject()),
      requestId,
    });
    return toProductDto(product.toObject());
  }

  private async assertUnique(sku?: string, barcode?: string, packBarcodes?: (string | undefined)[], exclude?: Types.ObjectId) {
    const codes = [barcode, ...(packBarcodes ?? [])].filter((c): c is string => Boolean(c));
    const or: FilterQuery<ProductDocument>[] = [];
    if (sku) or.push({ sku: sku.toUpperCase() });
    if (codes.length) or.push({ barcode: { $in: codes } }, { 'packUnits.barcode': { $in: codes } });
    if (!or.length) return;
    const clash = await this.products.findOne({ $or: or, ...(exclude ? { _id: { $ne: exclude } } : {}) }).lean();
    if (clash) {
      throw new ConflictError(
        `SKU or barcode already used by ${clash.brandName} (${clash.sku})`,
        ErrorCodes.DUPLICATE_KEY,
        { conflictingProductId: clash._id.toString() },
      );
    }
    const dupInPayload = new Set<string>();
    for (const c of codes) {
      if (dupInPayload.has(c)) throw new ConflictError(`Barcode ${c} appears more than once`, ErrorCodes.VALIDATION_FAILED);
      dupInPayload.add(c);
    }
  }
}

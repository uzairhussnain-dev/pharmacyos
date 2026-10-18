import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SaleRestrictions, type SaleRestriction } from '@pharmacy-os/shared-types';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class PackUnit {
  @Prop({ required: true, trim: true })
  name: string;

  /** Number of base units in one of this pack. Must be a positive integer. */
  @Prop({ required: true, min: 1, validate: Number.isInteger })
  multiplier: number;

  @Prop({ trim: true })
  barcode?: string;

  /** Optional explicit selling price per pack in minor units; otherwise multiplier * base price. */
  @Prop({ min: 0, validate: Number.isInteger })
  sellingPriceMinor?: number;
}
const PackUnitSchema = SchemaFactory.createForClass(PackUnit);

@Schema({ timestamps: true, collection: 'products' })
export class Product {
  @Prop({ required: true, unique: true, uppercase: true, trim: true, maxlength: 40 })
  sku: string;

  @Prop({ trim: true, maxlength: 64 })
  barcode?: string;

  @Prop({ required: true, trim: true, maxlength: 160 })
  brandName: string;

  @Prop({ required: true, trim: true, maxlength: 160 })
  genericName: string;

  @Prop({ trim: true, maxlength: 60 })
  strength?: string;

  @Prop({ required: true, trim: true, maxlength: 60 })
  dosageForm: string;

  @Prop({ trim: true, maxlength: 60 })
  route?: string;

  @Prop({ trim: true, maxlength: 120 })
  manufacturer?: string;

  /** DRAP registration number or similar; informational only. */
  @Prop({ trim: true, maxlength: 80 })
  registrationNumber?: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  category: string;

  /** Smallest sellable unit, e.g. "Tablet", "ml", "Bottle". */
  @Prop({ required: true, trim: true, maxlength: 30 })
  baseUnit: string;

  @Prop({ type: [PackUnitSchema], default: [] })
  packUnits: PackUnit[];

  /** Price per base unit in minor units (paisa). */
  @Prop({ required: true, min: 0, validate: Number.isInteger })
  sellingPriceMinor: number;

  @Prop({ default: 'STANDARD', trim: true })
  taxClass: string;

  /** Tax rate in basis points (e.g. 0 for exempt medicines, 1700 for 17%). */
  @Prop({ default: 0, min: 0, max: 10000, validate: Number.isInteger })
  taxRateBps: number;

  @Prop({ required: true, enum: SaleRestrictions, type: String, default: 'OTC' })
  saleRestriction: SaleRestriction;

  @Prop({ default: false })
  requiresPrescription: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: true })
  tracksExpiry: boolean;

  /** Base units at/below which the product is "low stock". */
  @Prop({ default: 0, min: 0 })
  reorderLevel: number;

  @Prop({ default: 0, min: 0 })
  reorderQuantity: number;

  @Prop({ default: 7, min: 0 })
  leadTimeDays: number;

  /** Cached balances maintained by the stock ledger (see docs/data-model.md). */
  @Prop({ default: 0 })
  onHandUnits: number;

  @Prop({ default: 0 })
  eligibleUnits: number;

  createdAt: Date;
  updatedAt: Date;
}

export type ProductDocument = HydratedDocument<Product>;
export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ barcode: 1 }, { unique: true, sparse: true });
ProductSchema.index({ 'packUnits.barcode': 1 }, { sparse: true });
ProductSchema.index({ brandName: 'text', genericName: 'text', sku: 'text' });
ProductSchema.index({ brandName: 1 });
ProductSchema.index({ genericName: 1 });
ProductSchema.index({ category: 1, isActive: 1 });

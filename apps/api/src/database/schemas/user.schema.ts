import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Roles, type Role } from '@pharmacy-os/shared-types';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 64 })
  username: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ required: true, enum: Roles, type: String })
  role: Role;

  @Prop({ default: true })
  isActive: boolean;

  /** Incremented to invalidate all outstanding refresh tokens (logout-all / password change). */
  @Prop({ default: 0 })
  tokenVersion: number;

  @Prop({ default: 0 })
  failedLoginAttempts: number;

  @Prop()
  lockedUntil?: Date;

  @Prop()
  lastLoginAt?: Date;

  @Prop()
  passwordChangedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolePermissions, Roles, type Role } from '@pharmacy-os/shared-types';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { FilterQuery, Model } from 'mongoose';
import { AuthUser, CurrentUser, RequestId, RequirePermissions } from '../../common/decorators';
import { ConflictError, DomainError, ErrorCodes, NotFoundError } from '../../common/errors';
import { PaginationQuery, escapeRegex, paginate } from '../../common/pagination';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { AuditService } from '../audit/audit.module';
import { AuthService } from '../auth/auth.service';

export class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-z0-9._-]+$/i, { message: 'username may contain letters, numbers, dot, dash, underscore' })
  username: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  @IsIn(Roles) role: Role;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(Roles) role?: Role;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
}

export class UpdateUserStatusDto {
  @IsBoolean() isActive: boolean;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export function toUserDto(u: UserDocument | (User & { _id: unknown })) {
  return {
    id: String(u._id),
    name: u.name,
    username: u.username,
    role: u.role,
    permissions: RolePermissions[u.role],
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaginationQuery) {
    const filter: FilterQuery<UserDocument> = {};
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: rx }, { username: rx }];
    }
    const [items, total] = await Promise.all([
      this.users.find(filter).sort({ createdAt: 1 }).skip(query.skip).limit(query.pageSize).lean(),
      this.users.countDocuments(filter),
    ]);
    return paginate(items.map(toUserDto), total, query);
  }

  async create(dto: CreateUserDto, actor: AuthUser, requestId: string) {
    const exists = await this.users.exists({ username: dto.username.toLowerCase() });
    if (exists) throw new ConflictError('Username already taken', ErrorCodes.DUPLICATE_KEY);
    const user = await this.users.create({
      name: dto.name,
      username: dto.username.toLowerCase(),
      passwordHash: await AuthService.hashPassword(dto.password),
      role: dto.role,
    });
    await this.audit.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'user.create',
      entityType: 'User',
      entityId: user._id,
      after: { name: user.name, username: user.username, role: user.role },
      requestId,
    });
    return toUserDto(user);
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser, requestId: string) {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('User', id);
    const before = { name: user.name, role: user.role };
    if (dto.name) user.name = dto.name;
    if (dto.role) {
      if (user._id.toString() === actor.id && dto.role !== user.role) {
        throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, 'You cannot change your own role');
      }
      user.role = dto.role;
    }
    if (dto.password) {
      user.passwordHash = await AuthService.hashPassword(dto.password);
      user.passwordChangedAt = new Date();
      user.tokenVersion += 1;
    }
    await user.save();
    await this.audit.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'user.update',
      entityType: 'User',
      entityId: user._id,
      before,
      after: { name: user.name, role: user.role, passwordChanged: Boolean(dto.password) },
      requestId,
    });
    return toUserDto(user);
  }

  async setStatus(id: string, dto: UpdateUserStatusDto, actor: AuthUser, requestId: string) {
    if (id === actor.id && !dto.isActive) {
      throw new DomainError(ErrorCodes.INVALID_STATE_TRANSITION, 'You cannot deactivate your own account');
    }
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('User', id);
    const before = { isActive: user.isActive };
    user.isActive = dto.isActive;
    if (!dto.isActive) user.tokenVersion += 1;
    await user.save();
    await this.audit.record({
      actorId: actor.id,
      actorName: actor.name,
      action: dto.isActive ? 'user.activate' : 'user.deactivate',
      entityType: 'User',
      entityId: user._id,
      before,
      after: { isActive: user.isActive },
      reason: dto.reason,
      requestId,
    });
    return toUserDto(user);
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  list(@Query() query: PaginationQuery) {
    return this.service.list(query);
  }

  @Post()
  @RequirePermissions('users.write')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.create(dto, actor, rid);
  }

  @Patch(':id')
  @RequirePermissions('users.write')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser, @RequestId() rid: string) {
    return this.service.update(id, dto, actor, rid);
  }

  @Patch(':id/status')
  @RequirePermissions('users.write')
  setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthUser,
    @RequestId() rid: string,
  ) {
    return this.service.setStatus(id, dto, actor, rid);
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

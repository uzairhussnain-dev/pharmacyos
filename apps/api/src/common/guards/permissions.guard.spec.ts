import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolePermissions, hasPermission } from '@pharmacy-os/shared-types';
import { PERMISSIONS_KEY } from '../decorators';
import { PermissionsGuard } from './permissions.guard';

const ctx = (user: unknown, required?: string[]): ExecutionContext =>
  ({
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    __required: required,
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  const reflector = { getAllAndOverride: (key: string, [h]: unknown[]) => (key === PERMISSIONS_KEY ? (h as never) : undefined) } as unknown as Reflector;

  const guardFor = (required?: string[]) =>
    new PermissionsGuard({
      getAllAndOverride: (key: string) => (key === PERMISSIONS_KEY ? required : undefined),
    } as unknown as Reflector);

  it('allows when no permissions are required', () => {
    expect(guardFor(undefined).canActivate(ctx({ permissions: [] }))).toBe(true);
    expect(guardFor([]).canActivate(ctx({ permissions: [] }))).toBe(true);
  });

  it('denies when user lacks a required permission', () => {
    expect(() => guardFor(['users.write']).canActivate(ctx({ permissions: RolePermissions.CASHIER }))).toThrow(/Missing permission: users.write/);
  });

  it('requires ALL listed permissions', () => {
    const g = guardFor(['pos.sell', 'pos.discount']);
    expect(() => g.canActivate(ctx({ permissions: RolePermissions.CASHIER }))).toThrow(/pos.discount/);
    expect(g.canActivate(ctx({ permissions: RolePermissions.PHARMACIST }))).toBe(true);
  });

  it('denies anonymous requests', () => {
    expect(() => guardFor(['products.read']).canActivate(ctx(undefined))).toThrow();
  });

  void reflector;
});

describe('RolePermissions matrix', () => {
  it('OWNER has everything, CASHIER cannot manage users/settings/approve returns', () => {
    expect(hasPermission('OWNER', 'users.write')).toBe(true);
    expect(hasPermission('OWNER', 'reconciliation.repair')).toBe(true);
    expect(hasPermission('CASHIER', 'users.write')).toBe(false);
    expect(hasPermission('CASHIER', 'settings.write')).toBe(false);
    expect(hasPermission('CASHIER', 'sales.return.approve')).toBe(false);
    expect(hasPermission('CASHIER', 'pos.discount')).toBe(false);
    expect(hasPermission('CASHIER', 'pos.sell')).toBe(true);
  });
  it('MANAGER cannot manage users or write settings; STOCK_MANAGER cannot sell', () => {
    expect(hasPermission('MANAGER', 'users.write')).toBe(false);
    expect(hasPermission('MANAGER', 'settings.write')).toBe(false);
    expect(hasPermission('MANAGER', 'cash.reconcile')).toBe(true);
    expect(hasPermission('STOCK_MANAGER', 'pos.sell')).toBe(false);
    expect(hasPermission('STOCK_MANAGER', 'purchasing.receive')).toBe(true);
  });
  it('rejects undefined role', () => {
    expect(hasPermission(undefined, 'pos.sell')).toBe(false);
  });
});

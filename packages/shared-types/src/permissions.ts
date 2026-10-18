export const Roles = ['OWNER', 'MANAGER', 'PHARMACIST', 'CASHIER', 'STOCK_MANAGER'] as const;
export type Role = (typeof Roles)[number];

/**
 * Fine-grained permissions. Roles map to permission sets on the server; the frontend
 * uses the same map only to hide controls — never for enforcement.
 */
export const Permissions = [
  'users.read',
  'users.write',
  'products.read',
  'products.write',
  'inventory.read',
  'inventory.adjust',
  'inventory.count',
  'inventory.count.approve',
  'suppliers.read',
  'suppliers.write',
  'purchasing.read',
  'purchasing.write',
  'purchasing.receive',
  'purchasing.return',
  'pos.sell',
  'pos.discount',
  'pos.credit',
  'sales.read',
  'sales.return',
  'sales.return.approve',
  'payments.refund',
  'cash.session',
  'cash.reconcile',
  'expenses.read',
  'expenses.write',
  'reports.read',
  'finance.read',
  'intelligence.read',
  'intelligence.resolve',
  'intelligence.rebuild',
  'audit.read',
  'settings.read',
  'settings.write',
  'reconciliation.run',
  'reconciliation.repair',
  'customers.read',
  'customers.write',
] as const;
export type Permission = (typeof Permissions)[number];

const ALL: Permission[] = [...Permissions];

export const RolePermissions: Record<Role, Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => !['users.write', 'settings.write'].includes(p)),
  PHARMACIST: [
    'products.read',
    'products.write',
    'inventory.read',
    'inventory.adjust',
    'inventory.count',
    'inventory.count.approve',
    'suppliers.read',
    'purchasing.read',
    'purchasing.receive',
    'pos.sell',
    'pos.discount',
    'sales.read',
    'sales.return',
    'sales.return.approve',
    'cash.session',
    'reports.read',
    'intelligence.read',
    'intelligence.resolve',
    'customers.read',
    'customers.write',
    'settings.read',
  ],
  CASHIER: [
    'products.read',
    'inventory.read',
    'pos.sell',
    'sales.read',
    'sales.return',
    'cash.session',
    'customers.read',
    'customers.write',
  ],
  STOCK_MANAGER: [
    'products.read',
    'products.write',
    'inventory.read',
    'inventory.adjust',
    'inventory.count',
    'suppliers.read',
    'suppliers.write',
    'purchasing.read',
    'purchasing.write',
    'purchasing.receive',
    'purchasing.return',
    'sales.read',
    'reports.read',
    'intelligence.read',
    'intelligence.resolve',
    'settings.read',
  ],
};

export function hasPermission(role: Role | undefined, permission: Permission): boolean {
  if (!role) return false;
  return RolePermissions[role]?.includes(permission) ?? false;
}

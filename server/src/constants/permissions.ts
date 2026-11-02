import type { UserRole } from './roles';

export const PERMISSIONS = [
  'products:read',
  'products:write',
  'media:manage',
  'orders:read',
  'orders:update_status',
  'orders:refund',
  'artwork:review',
  'messages:manage',
  'reviews:moderate',
  'staff:manage',
  'customers:read',
  'analytics:read',
  'settings:write',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  production: ['orders:read', 'orders:update_status', 'artwork:review'],
  support: ['orders:read', 'messages:manage', 'reviews:moderate'],
  customer: [],
};

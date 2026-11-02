export const USER_ROLES = [
  'customer',
  'admin',
  'production',
  'support',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATES = ['active', 'suspended'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

import { randomBytes } from 'node:crypto';

export function generateOrderNumber(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomBytes(4).toString('hex').toUpperCase();
  return `DB-${date}-${suffix}`;
}

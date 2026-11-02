import Stripe from 'stripe';

import { env } from './env';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export const STRIPE_API_VERSION = '2026-09-30.endive' as const;

let client: Stripe | undefined;

export function getStripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(
      'Stripe is not configured',
      503,
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
    );
  }
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
    });
  }
  return client;
}

export function logStripeError(error: unknown, message: string): void {
  const requestId =
    typeof error === 'object' && error !== null && 'requestId' in error
      ? String(error.requestId)
      : undefined;
  logger.error({ requestId }, message);
}

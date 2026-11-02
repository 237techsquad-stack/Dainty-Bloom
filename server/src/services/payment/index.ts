import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { ManualPaymentProvider } from './ManualPaymentProvider';
import { StripePaymentProvider } from './StripePaymentProvider';
import type { PaymentProvider } from './PaymentProvider';

const providers: Record<string, PaymentProvider> = {
  manual: new ManualPaymentProvider(),
  stripe: new StripePaymentProvider(),
};

export function getPaymentProvider(): PaymentProvider {
  return getPaymentProviderByName(env.PAYMENT_PROVIDER);
}

export function getPaymentProviderByName(name: string): PaymentProvider {
  const provider = providers[name];
  if (!provider) {
    throw new AppError(
      'Configured payment provider is not available',
      503,
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
    );
  }
  return provider;
}

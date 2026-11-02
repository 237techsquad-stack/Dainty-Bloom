export type StripeEnvironmentVariable =
  | 'PAYMENT_PROVIDER'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_PUBLISHABLE_KEY'
  | 'STRIPE_WEBHOOK_SECRET';

export interface StripeEnvironmentIssue {
  path: StripeEnvironmentVariable | 'ALLOW_LIVE_STRIPE_IN_DEVELOPMENT';
  message: string;
}

export function validateStripeEnvironment(input: {
  paymentProvider: 'manual' | 'stripe';
  nodeEnv: 'development' | 'test' | 'production';
  allowLiveModeInDevelopment?: boolean;
  requireStripeProvider?: boolean;
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
}): StripeEnvironmentIssue[] {
  const issues: StripeEnvironmentIssue[] = [];
  if (input.allowLiveModeInDevelopment && input.nodeEnv !== 'development') {
    issues.push({
      path: 'ALLOW_LIVE_STRIPE_IN_DEVELOPMENT',
      message:
        'ALLOW_LIVE_STRIPE_IN_DEVELOPMENT can only be enabled in development',
    });
  }
  if (input.allowLiveModeInDevelopment && input.paymentProvider !== 'stripe') {
    issues.push({
      path: 'ALLOW_LIVE_STRIPE_IN_DEVELOPMENT',
      message:
        'ALLOW_LIVE_STRIPE_IN_DEVELOPMENT requires PAYMENT_PROVIDER=stripe',
    });
  }
  if (input.paymentProvider !== 'stripe') {
    if (input.requireStripeProvider) {
      issues.push({
        path: 'PAYMENT_PROVIDER',
        message: 'Production requires PAYMENT_PROVIDER=stripe',
      });
    }
    return issues;
  }

  if (!input.secretKey) {
    issues.push({
      path: 'STRIPE_SECRET_KEY',
      message: 'STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe',
    });
  } else if (isPlaceholder(input.secretKey)) {
    issues.push({
      path: 'STRIPE_SECRET_KEY',
      message: 'STRIPE_SECRET_KEY must contain a configured Stripe key',
    });
  }
  if (!input.publishableKey) {
    issues.push({
      path: 'STRIPE_PUBLISHABLE_KEY',
      message:
        'STRIPE_PUBLISHABLE_KEY is required when PAYMENT_PROVIDER=stripe',
    });
  } else if (isPlaceholder(input.publishableKey)) {
    issues.push({
      path: 'STRIPE_PUBLISHABLE_KEY',
      message: 'STRIPE_PUBLISHABLE_KEY must contain a configured Stripe key',
    });
  }
  if (!input.webhookSecret) {
    issues.push({
      path: 'STRIPE_WEBHOOK_SECRET',
      message: 'STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe',
    });
  } else if (isPlaceholder(input.webhookSecret)) {
    issues.push({
      path: 'STRIPE_WEBHOOK_SECRET',
      message:
        'STRIPE_WEBHOOK_SECRET must contain a configured Stripe signing secret',
    });
  } else if (!input.webhookSecret.startsWith('whsec_')) {
    issues.push({
      path: 'STRIPE_WEBHOOK_SECRET',
      message: 'STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret',
    });
  }

  const secretMode = input.secretKey?.match(/^(?:sk|rk)_(test|live)_/)?.[1];
  if (input.secretKey && !secretMode) {
    issues.push({
      path: 'STRIPE_SECRET_KEY',
      message:
        'STRIPE_SECRET_KEY must use a recognized Stripe test or live key format',
    });
  }

  const publishableMode = input.publishableKey?.match(/^pk_(test|live)_/)?.[1];
  if (input.publishableKey && !publishableMode) {
    issues.push({
      path: 'STRIPE_PUBLISHABLE_KEY',
      message:
        'STRIPE_PUBLISHABLE_KEY must use a recognized Stripe test or live key format',
    });
  }

  if (secretMode && publishableMode && secretMode !== publishableMode) {
    issues.push({
      path: 'STRIPE_PUBLISHABLE_KEY',
      message:
        'STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY must use the same test or live mode',
    });
  }

  if (
    input.nodeEnv !== 'production' &&
    !(input.nodeEnv === 'development' && input.allowLiveModeInDevelopment) &&
    (secretMode === 'live' || publishableMode === 'live')
  ) {
    issues.push({
      path: 'STRIPE_SECRET_KEY',
      message:
        'Non-production Stripe configuration must use test-mode credentials',
    });
  }

  return issues;
}

function isPlaceholder(value: string): boolean {
  return /placeholder|replace[_ -]?(?:with|me)/i.test(value);
}

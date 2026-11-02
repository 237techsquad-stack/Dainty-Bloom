import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadEnvironment } from '../src/config/loadEnvironment';
import { validateStripeEnvironment } from '../src/config/stripeEnvValidation';

describe('loadEnvironment', () => {
  it('uses the override file first and fills missing values from .env', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dainty-bloom-env-'));
    const overridePath = join(directory, '.env.stripe-test');
    const envPath = join(directory, '.env');
    const target: NodeJS.ProcessEnv = {
      PAYMENT_PROVIDER: 'manual',
      STRIPE_SECRET_KEY: 'sk_live_inherited',
    };

    try {
      writeFileSync(
        overridePath,
        'PAYMENT_PROVIDER=stripe\nSTRIPE_SECRET_KEY=sk_test_placeholder\n',
      );
      writeFileSync(
        envPath,
        'PAYMENT_PROVIDER=manual\nSTRIPE_PUBLISHABLE_KEY=pk_test_placeholder\nPORT=5000\n',
      );

      loadEnvironment(overridePath, target, envPath);

      expect(target.PAYMENT_PROVIDER).toBe('stripe');
      expect(target.STRIPE_SECRET_KEY).toBe('sk_test_placeholder');
      expect(target.STRIPE_PUBLISHABLE_KEY).toBe('pk_test_placeholder');
      expect(target.PORT).toBe('5000');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails clearly when the explicitly selected override cannot be loaded', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dainty-bloom-env-'));

    try {
      expect(() =>
        loadEnvironment(
          join(directory, 'missing.env'),
          {},
          join(directory, '.env'),
        ),
      ).toThrow('DOTENV_CONFIG_PATH could not be loaded');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('validateStripeEnvironment', () => {
  it('does not require Stripe credentials for the manual provider', () => {
    expect(
      validateStripeEnvironment({
        paymentProvider: 'manual',
        nodeEnv: 'development',
      }),
    ).toEqual([]);
  });

  it('rejects the manual provider in production', () => {
    expect(
      validateStripeEnvironment({
        paymentProvider: 'manual',
        nodeEnv: 'production',
        requireStripeProvider: true,
      }),
    ).toEqual([
      {
        path: 'PAYMENT_PROVIDER',
        message: 'Production requires PAYMENT_PROVIDER=stripe',
      },
    ]);
  });

  it('requires all Stripe credentials when Stripe is selected', () => {
    expect(
      validateStripeEnvironment({
        paymentProvider: 'stripe',
        nodeEnv: 'development',
      }).map(({ path }) => path),
    ).toEqual([
      'STRIPE_SECRET_KEY',
      'STRIPE_PUBLISHABLE_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ]);
  });

  it('rejects mismatched secret and publishable key modes', () => {
    const issues = validateStripeEnvironment({
      paymentProvider: 'stripe',
      nodeEnv: 'development',
      secretKey: 'sk_test_placeholder',
      publishableKey: 'pk_live_placeholder',
      webhookSecret: 'whsec_placeholder',
    });

    expect(issues).toContainEqual({
      path: 'STRIPE_PUBLISHABLE_KEY',
      message:
        'STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY must use the same test or live mode',
    });
  });

  it('accepts a matching test-mode configuration', () => {
    expect(
      validateStripeEnvironment({
        paymentProvider: 'stripe',
        nodeEnv: 'development',
        secretKey: 'sk_test_configured',
        publishableKey: 'pk_test_configured',
        webhookSecret: 'whsec_configured',
      }),
    ).toEqual([]);
  });

  it('accepts matching live-mode credentials in production', () => {
    expect(
      validateStripeEnvironment({
        paymentProvider: 'stripe',
        nodeEnv: 'production',
        secretKey: 'sk_live_configured',
        publishableKey: 'pk_live_configured',
        webhookSecret: 'whsec_configured',
      }),
    ).toEqual([]);
  });

  it('accepts live credentials in development only with explicit opt-in', () => {
    expect(
      validateStripeEnvironment({
        paymentProvider: 'stripe',
        nodeEnv: 'development',
        allowLiveModeInDevelopment: true,
        secretKey: 'sk_live_configured',
        publishableKey: 'pk_live_configured',
        webhookSecret: 'whsec_configured',
      }),
    ).toEqual([]);
  });

  it('rejects the development opt-in outside development', () => {
    expect(
      validateStripeEnvironment({
        paymentProvider: 'stripe',
        nodeEnv: 'production',
        allowLiveModeInDevelopment: true,
        secretKey: 'sk_live_configured',
        publishableKey: 'pk_live_configured',
        webhookSecret: 'whsec_configured',
      }),
    ).toContainEqual({
      path: 'ALLOW_LIVE_STRIPE_IN_DEVELOPMENT',
      message:
        'ALLOW_LIVE_STRIPE_IN_DEVELOPMENT can only be enabled in development',
    });
  });

  it('rejects live-mode keys in non-production environments', () => {
    const issues = validateStripeEnvironment({
      paymentProvider: 'stripe',
      nodeEnv: 'development',
      secretKey: 'sk_live_placeholder',
      publishableKey: 'pk_live_placeholder',
      webhookSecret: 'whsec_placeholder',
    });

    expect(issues).toContainEqual({
      path: 'STRIPE_SECRET_KEY',
      message:
        'Non-production Stripe configuration must use test-mode credentials',
    });
  });

  it('rejects unrecognized key formats without revealing their values', () => {
    const issues = validateStripeEnvironment({
      paymentProvider: 'stripe',
      nodeEnv: 'development',
      secretKey: 'not-a-key',
      publishableKey: 'not-a-public-key',
      webhookSecret: 'not-a-webhook-secret',
    });

    expect(issues.map(({ path }) => path)).toEqual([
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY',
      'STRIPE_PUBLISHABLE_KEY',
    ]);
    expect(JSON.stringify(issues)).not.toContain('not-a-key');
    expect(JSON.stringify(issues)).not.toContain('not-a-public-key');
    expect(JSON.stringify(issues)).not.toContain('not-a-webhook-secret');
  });

  it('rejects template placeholders as credentials', () => {
    const issues = validateStripeEnvironment({
      paymentProvider: 'stripe',
      nodeEnv: 'development',
      secretKey: 'sk_test_replace_with_your_test_secret_key',
      publishableKey: 'pk_test_replace_with_your_test_publishable_key',
      webhookSecret: 'whsec_replace_with_your_test_webhook_secret',
    });

    expect(issues.map(({ path }) => path)).toEqual([
      'STRIPE_SECRET_KEY',
      'STRIPE_PUBLISHABLE_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ]);
  });
});

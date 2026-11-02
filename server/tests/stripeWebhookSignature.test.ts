import express from 'express';
import request from 'supertest';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { constructEvent, processStripeWebhook } = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  processStripeWebhook: vi.fn(),
}));

vi.mock('../src/config/env', () => ({
  env: { STRIPE_WEBHOOK_SECRET: 'whsec_test_only' },
}));

vi.mock('../src/config/stripe', () => ({
  getStripeClient: () => ({ webhooks: { constructEvent } }),
}));

vi.mock('../src/services/payment/paymentFlow.service', () => ({
  confirmOrderPayment: vi.fn(),
  getOrderPaymentStatus: vi.fn(),
  processStripeWebhook,
  startOrderCheckout: vi.fn(),
}));

import { stripeWebhook } from '../src/controllers/payment.controller';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Stripe webhook signature verification', () => {
  it('passes the raw body and signature to Stripe verification before processing', async () => {
    const event = { id: 'evt_signature_valid' } as Stripe.Event;
    constructEvent.mockReturnValue(event);
    processStripeWebhook.mockResolvedValue(undefined);
    const app = createWebhookTestApp();

    const response = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'test_signature')
      .send('{"id":"evt_signature_valid"}');

    expect(response.status).toBe(200);
    expect(constructEvent).toHaveBeenCalledWith(
      expect.any(Buffer),
      'test_signature',
      'whsec_test_only',
    );
    expect(processStripeWebhook).toHaveBeenCalledWith(event);
  });

  it('rejects invalid signatures without processing the event', async () => {
    constructEvent.mockImplementationOnce(() => {
      throw new Error('invalid test signature');
    });
    const app = createWebhookTestApp();

    const response = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'invalid_signature')
      .send('{"id":"evt_signature_invalid"}');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_STRIPE_SIGNATURE' },
    });
    expect(processStripeWebhook).not.toHaveBeenCalled();
  });
});

function createWebhookTestApp(): express.Express {
  const app = express();
  app.post(
    '/webhook',
    express.raw({ type: 'application/json' }),
    stripeWebhook,
  );
  return app;
}

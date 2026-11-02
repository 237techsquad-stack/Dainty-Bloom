import type { RequestHandler } from 'express';
import type Stripe from 'stripe';

import { env } from '../config/env';
import { getStripeClient } from '../config/stripe';
import {
  confirmOrderPayment,
  getOrderPaymentStatus,
  processStripeWebhook,
  startOrderCheckout,
} from '../services/payment/paymentFlow.service';
import { asyncHandler } from '../utils/asyncHandler';

export const startPayment: RequestHandler = asyncHandler(async (req, res) => {
  const data = await startOrderCheckout(req.params.orderNumber, {
    user: req.user,
    email: req.user ? undefined : req.body.email,
  });
  res.json({ success: true, data });
});

export const confirmPayment: RequestHandler = asyncHandler(async (req, res) => {
  const data = await confirmOrderPayment(req.params.orderNumber, {
    user: req.user,
    email: req.user ? undefined : req.body?.email,
  });
  res.json({ success: true, data });
});

export const paymentStatus: RequestHandler = asyncHandler(async (req, res) => {
  const data = await getOrderPaymentStatus(req.params.orderNumber, {
    user: req.user,
    email: req.user ? undefined : String(req.query.email ?? ''),
  });
  res.json({ success: true, data });
});

export const stripeWebhook: RequestHandler = asyncHandler(async (req, res) => {
  const signature = req.header('stripe-signature');
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret || !Buffer.isBuffer(req.body)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_STRIPE_SIGNATURE',
        message: 'Invalid webhook signature',
        details: null,
      },
    });
    return;
  }
  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      req.body,
      signature,
      secret,
    );
  } catch {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_STRIPE_SIGNATURE',
        message: 'Invalid webhook signature',
        details: null,
      },
    });
    return;
  }
  await processStripeWebhook(event);
  res.status(200).json({ received: true });
});

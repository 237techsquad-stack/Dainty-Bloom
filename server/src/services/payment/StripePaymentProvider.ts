import { env } from '../../config/env';
import { getStripeClient, logStripeError } from '../../config/stripe';
import type { IOrder } from '../../models/Order';
import { AppError } from '../../utils/AppError';
import { STORE_CURRENCY } from '../../utils/currency';
import { logger } from '../../utils/logger';
import type { PaymentProvider } from './PaymentProvider';

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  readonly supportsRefund = true;

  async createPayment(_order: IOrder): Promise<{ reference?: string }> {
    return {};
  }

  async createCheckoutSession(
    order: IOrder,
    attempt: number,
    options?: { expiresAt?: Date },
  ) {
    if (order.currency !== STORE_CURRENCY) {
      throw new AppError(
        'Stripe Checkout only accepts GBP orders',
        409,
        'PAYMENT_CURRENCY_MISMATCH',
      );
    }
    if (order.customOffer) {
      if (
        order.discountMinor !== 0 ||
        order.shippingMinor !== 0 ||
        order.taxMinor !== 0 ||
        order.items.length !== 1 ||
        order.items[0].quantity !== 1 ||
        order.items[0].lineTotalMinor !== order.totalMinor
      ) {
        throw new AppError(
          'Private offer orders must keep a single fixed-price line with no additional adjustments',
          409,
          'PRIVATE_OFFER_TOTAL_MISMATCH',
        );
      }
    }
    const stripe = getStripeClient();
    const expectedTotal = order.customOffer
      ? order.totalMinor
      : order.items.reduce(
          (sum, item) => sum + item.unitPriceMinor * item.quantity,
          0,
        ) -
        order.discountMinor +
        order.shippingMinor +
        order.taxMinor;
    if (expectedTotal !== order.totalMinor || expectedTotal <= 0) {
      logger.error(
        { orderId: order._id.toString() },
        'Persisted order amounts do not match Stripe Checkout total',
      );
      throw new AppError(
        'Stored order totals do not reconcile',
        409,
        'PAYMENT_TOTAL_MISMATCH',
      );
    }
    const currency = order.currency.toLowerCase();
    const metadata = {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      ...(order.customOffer
        ? {
            customOfferId: order.customOffer.toString(),
            ...(order.user ? { customerId: order.user.toString() } : {}),
            productId:
              order.items[0] && order.items[0].product
                ? order.items[0].product.toString()
                : '',
          }
        : {}),
    };
    const lineItems: Array<{
      quantity: number;
      price_data: {
        currency: string;
        unit_amount: number;
        product_data: { name: string };
      };
    }> = order.customOffer
      ? [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: order.totalMinor,
              product_data: {
                name: optionedTitle(
                  order.items[0].titleSnapshot,
                  order.items[0].selectedOptions,
                ),
              },
            },
          },
        ]
      : order.items.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency,
            unit_amount: item.unitPriceMinor,
            product_data: {
              name: optionedTitle(item.titleSnapshot, item.selectedOptions),
            },
          },
        }));
    if (!order.customOffer && order.shippingMinor > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: order.shippingMinor,
          product_data: { name: 'Shipping' },
        },
      });
    }
    if (!order.customOffer && order.taxMinor > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: order.taxMinor,
          product_data: { name: 'Tax' },
        },
      });
    }
    let createdSession:
      Awaited<ReturnType<typeof stripe.checkout.sessions.create>> | undefined;
    try {
      const discounts =
        order.discountMinor > 0
          ? [
              {
                coupon: (
                  await stripe.coupons.create(
                    {
                      amount_off: order.discountMinor,
                      currency,
                      duration: 'once',
                      name: `Order ${order.orderNumber}`,
                    },
                    {
                      idempotencyKey: `order:${order._id}:attempt:${attempt}:coupon`,
                    },
                  )
                ).id,
              },
            ]
          : undefined;
      const minimumPrivateExpiry = 30 * 60_000 + 10_000;
      const configuredExpiry =
        Date.now() +
        (options?.expiresAt
          ? Math.max(
              env.STRIPE_CHECKOUT_EXPIRY_MINUTES * 60_000,
              minimumPrivateExpiry,
            )
          : env.STRIPE_CHECKOUT_EXPIRY_MINUTES * 60_000);
      const expiresAt = new Date(
        options?.expiresAt
          ? Math.min(configuredExpiry, options.expiresAt.getTime())
          : configuredExpiry,
      );
      if (
        options?.expiresAt &&
        expiresAt.getTime() < Date.now() + 30 * 60_000 + 5_000
      ) {
        throw new AppError(
          'The private offer expires before Stripe can safely expire a Checkout Session',
          409,
          'CUSTOM_OFFER_EXPIRY_TOO_SOON',
        );
      }
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: lineItems,
          ...(discounts ? { discounts } : {}),
          client_reference_id: order.orderNumber,
          metadata,
          payment_intent_data: { metadata },
          customer_email: order.contactSnapshot.email,
          success_url: `${env.CLIENT_URL}/checkout/success?order=${encodeURIComponent(order.orderNumber)}`,
          cancel_url: `${env.CLIENT_URL}/checkout/cancelled?order=${encodeURIComponent(order.orderNumber)}`,
          expires_at: Math.floor(expiresAt.getTime() / 1000),
        },
        {
          idempotencyKey: `order:${order._id}:attempt:${attempt}:checkout`,
        },
      );
      createdSession = session;
      if (
        session.amount_total !== order.totalMinor ||
        session.currency !== currency
      ) {
        logger.error(
          { orderId: order._id.toString() },
          'Stripe Checkout session amount does not match persisted order total',
        );
        throw new AppError(
          'Stripe Checkout total does not match the order',
          409,
          'PAYMENT_TOTAL_MISMATCH',
        );
      }
      if (
        options?.expiresAt &&
        session.expires_at * 1000 > options.expiresAt.getTime()
      ) {
        await stripe.checkout.sessions.expire(session.id);
        throw new AppError(
          'Stripe Checkout Session expires after the private offer',
          409,
          'PAYMENT_SESSION_EXPIRY_MISMATCH',
        );
      }
      if (!session.url) {
        throw new AppError(
          'Stripe did not provide a checkout URL',
          502,
          'PAYMENT_PROVIDER_ERROR',
        );
      }
      return {
        id: session.id,
        url: session.url,
        expiresAt: new Date(session.expires_at * 1000),
        ...(typeof session.payment_intent === 'string'
          ? { paymentIntentId: session.payment_intent }
          : {}),
      };
    } catch (error) {
      if (createdSession) {
        try {
          await stripe.checkout.sessions.expire(createdSession.id);
        } catch (expiryError) {
          logStripeError(
            expiryError,
            'Stripe Checkout session could not be expired after a local failure',
          );
          throw new AppError(
            'A Checkout Session was created but could not be safely expired; manual reconciliation is required',
            502,
            'PAYMENT_SESSION_RECOVERY_REQUIRED',
            {
              sessionId: createdSession.id,
              expiresAt: createdSession.expires_at,
            },
          );
        }
      }
      if (error instanceof AppError) throw error;
      logStripeError(error, 'Stripe Checkout session creation failed');
      throw new AppError(
        'Payment provider request failed',
        502,
        'PAYMENT_PROVIDER_ERROR',
      );
    }
  }

  async retrieveCheckoutSession(sessionId: string) {
    try {
      const session =
        await getStripeClient().checkout.sessions.retrieve(sessionId);
      return {
        paymentStatus: session.payment_status,
        amountMinor: session.amount_total ?? 0,
        currency: session.currency?.toUpperCase() ?? '',
        ...(typeof session.payment_intent === 'string'
          ? { paymentIntentId: session.payment_intent }
          : {}),
      };
    } catch (error) {
      logStripeError(error, 'Stripe Checkout session retrieval failed');
      throw new AppError(
        'Payment provider request failed',
        502,
        'PAYMENT_PROVIDER_ERROR',
      );
    }
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    try {
      await getStripeClient().checkout.sessions.expire(sessionId);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'resource_missing'
      ) {
        return;
      }
      logStripeError(error, 'Stripe Checkout session expiration failed');
      throw new AppError(
        'Payment provider request failed',
        502,
        'PAYMENT_PROVIDER_ERROR',
      );
    }
  }

  async verifyPayment(input: {
    order: IOrder;
    reference: string;
    amountMinor: number;
  }): Promise<boolean> {
    const sessionId =
      input.order.payment.stripeCheckoutSessionId ?? input.reference;
    if (!sessionId) return false;
    const session = await this.retrieveCheckoutSession(sessionId);
    return (
      session.paymentStatus === 'paid' &&
      input.amountMinor === input.order.totalMinor
    );
  }

  async refund(input: {
    order: IOrder;
    amountMinor: number;
    reference?: string;
    reason?: string;
    idempotencyKey?: string;
  }) {
    const paymentIntentId =
      input.order.payment.stripePaymentIntentId ??
      input.order.payment.providerReference;
    if (!paymentIntentId) {
      throw new AppError(
        'Stripe payment intent is not recorded',
        409,
        'PAYMENT_INTENT_NOT_FOUND',
      );
    }
    try {
      const refund = await getStripeClient().refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: input.amountMinor,
          reason: 'requested_by_customer',
          metadata: {
            orderId: input.order._id.toString(),
            orderNumber: input.order.orderNumber,
            reason: input.reason ?? '',
          },
        },
        {
          idempotencyKey:
            input.idempotencyKey ??
            `order:${input.order._id}:refund:${input.order.refunds.length + 1}`,
        },
      );
      return { supported: true, reference: refund.id };
    } catch (error) {
      logStripeError(error, 'Stripe refund request failed');
      throw new AppError(
        'Payment provider request failed',
        502,
        'PAYMENT_PROVIDER_ERROR',
      );
    }
  }
}

function optionedTitle(
  title: string,
  options: Array<{
    label?: string;
    valueLabel?: string;
    key: string;
    value: string;
  }>,
): string {
  const summary = options
    .map(
      (option) =>
        `${option.label ?? option.key}: ${option.valueLabel ?? option.value}`,
    )
    .join(', ');
  const name = summary ? `${title} (${summary})` : title;
  return name.length > 240 ? `${name.slice(0, 237)}...` : name;
}

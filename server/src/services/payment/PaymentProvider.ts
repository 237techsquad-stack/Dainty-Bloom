import type { IOrder } from '../../models/Order';

export interface PaymentProvider {
  readonly name: string;
  readonly supportsRefund?: boolean;
  createPayment(order: IOrder): Promise<{ reference?: string }>;
  verifyPayment(input: {
    order: IOrder;
    reference: string;
    amountMinor: number;
  }): Promise<boolean>;
  refund(input: {
    order: IOrder;
    amountMinor: number;
    reference?: string;
    reason?: string;
    idempotencyKey?: string;
  }): Promise<{ supported: boolean; reference?: string }>;
  createCheckoutSession?(
    order: IOrder,
    attempt: number,
    options?: { expiresAt?: Date },
  ): Promise<{
    id: string;
    url: string;
    expiresAt: Date;
    paymentIntentId?: string;
  }>;
  retrieveCheckoutSession?(sessionId: string): Promise<{
    paymentStatus: string;
    amountMinor: number;
    currency: string;
    paymentIntentId?: string;
  }>;
  expireCheckoutSession?(sessionId: string): Promise<void>;
}

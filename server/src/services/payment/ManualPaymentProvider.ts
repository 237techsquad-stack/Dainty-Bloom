import type { IOrder } from '../../models/Order';
import type { PaymentProvider } from './PaymentProvider';

export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual';
  readonly supportsRefund = false;

  async createPayment(_order: IOrder): Promise<{ reference?: string }> {
    return {};
  }

  async verifyPayment(input: {
    order: IOrder;
    amountMinor: number;
  }): Promise<boolean> {
    return input.amountMinor === input.order.totalMinor;
  }

  async refund(): Promise<{ supported: boolean }> {
    return { supported: false };
  }
}

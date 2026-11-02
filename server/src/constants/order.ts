export const PAYMENT_STATUS = [
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
  'refund_due',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const FULFILLMENT_STATUS = [
  'unfulfilled',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUS)[number];

export const PRINT_STATUS = [
  'pending',
  'queued',
  'printing',
  'printed',
  'quality_check',
  'pending_proof_approval',
  'artwork_rejected',
  'approved',
  'in_printing',
  'ready',
  'shipped',
  'completed',
  'cancelled',
] as const;
export type PrintStatus = (typeof PRINT_STATUS)[number];

export const ORDER_STATUS_TRANSITIONS = {
  pending_payment: ['pending_proof_approval', 'in_printing', 'cancelled'],
  pending_proof_approval: ['artwork_rejected', 'in_printing', 'cancelled'],
  artwork_rejected: ['pending_proof_approval', 'cancelled'],
  in_printing: ['ready', 'cancelled'],
  ready: ['shipped'],
  shipped: ['completed'],
  completed: [],
  cancelled: [],
} as const;

export type OrderStatus = keyof typeof ORDER_STATUS_TRANSITIONS;

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_STATUS_TRANSITIONS[from] as readonly OrderStatus[]).includes(
    to,
  );
}

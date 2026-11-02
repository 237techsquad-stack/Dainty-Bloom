import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  PackageCheck,
  Printer,
  Truck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

export const ORDER_STATUS = {
  pending_payment: {
    label: 'Awaiting payment',
    tone: 'warning',
    icon: Clock3,
  },
  pending_proof_approval: {
    label: 'Awaiting artwork approval',
    tone: 'warning',
    icon: Clock3,
  },
  artwork_rejected: {
    label: 'Artwork needs changes',
    tone: 'danger',
    icon: CircleAlert,
  },
  in_printing: { label: 'In production', tone: 'info', icon: Printer },
  ready: { label: 'Ready', tone: 'success', icon: PackageCheck },
  shipped: { label: 'Shipped', tone: 'info', icon: Truck },
  completed: { label: 'Completed', tone: 'success', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', tone: 'danger', icon: XCircle },
} as const satisfies Record<
  string,
  { label: string; tone: string; icon: LucideIcon }
>;

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS[status as keyof typeof ORDER_STATUS]?.label ??
    status.replaceAll('_', ' ');
}

export function orderStatusTone(status: string): string {
  return ORDER_STATUS[status as keyof typeof ORDER_STATUS]?.tone ?? 'neutral';
}

export function orderStatusIcon(status: string): LucideIcon {
  return ORDER_STATUS[status as keyof typeof ORDER_STATUS]?.icon ?? CircleAlert;
}

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Payment pending',
  paid: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
  refund_due: 'Refund due',
};

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABEL[status] ?? status.replaceAll('_', ' ');
}

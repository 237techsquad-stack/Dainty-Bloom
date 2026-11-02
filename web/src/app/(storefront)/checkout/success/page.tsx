import type { Metadata } from 'next';
import { PaymentResultPage } from '@/components/orders/PaymentResultPage';

export const metadata: Metadata = {
  title: 'Payment status',
  robots: { index: false, follow: false },
};

export default async function CheckoutSuccessRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const order = params.order;
  return <PaymentResultPage orderNumber={Array.isArray(order) ? order[0] ?? '' : order ?? ''} />;
}

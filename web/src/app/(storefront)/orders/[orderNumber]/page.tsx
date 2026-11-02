import type { Metadata } from 'next';
import { OrderDetailPage } from '@/components/orders/OrderDetailPage';

export const metadata: Metadata = {
  title: 'Order details',
  robots: { index: false, follow: false },
};

export default async function CustomerOrderRoute({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orderNumber }, query] = await Promise.all([params, searchParams]);
  const placed = query.placed;
  return (
    <OrderDetailPage
      orderNumber={orderNumber}
      placed={placed === '1' || (Array.isArray(placed) && placed.includes('1'))}
    />
  );
}

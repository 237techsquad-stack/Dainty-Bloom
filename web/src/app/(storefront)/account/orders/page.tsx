import type { Metadata } from 'next';
import { OrderHistoryPage } from '@/components/orders/OrderHistoryPage';

export const metadata: Metadata = {
  title: 'My orders',
  robots: { index: false, follow: false },
};

export default function CustomerOrdersRoute() {
  return <OrderHistoryPage />;
}

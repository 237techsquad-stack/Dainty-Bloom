import type { Metadata } from 'next';
import { TrackOrderPage } from '@/components/orders/TrackOrderPage';

export const metadata: Metadata = {
  title: 'Track an order',
  robots: { index: false, follow: false },
};

export default function TrackOrderRoute() {
  return <TrackOrderPage />;
}

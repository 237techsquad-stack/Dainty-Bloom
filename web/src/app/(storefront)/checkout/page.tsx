import type { Metadata } from 'next';
import { CheckoutPage } from '@/components/orders/CheckoutPage';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default function CheckoutRoute() {
  return <CheckoutPage />;
}

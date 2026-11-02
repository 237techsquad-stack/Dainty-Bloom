import type { Metadata } from 'next';
import { CustomerProfilePage } from '@/components/account/CustomerProfilePage';

export const metadata: Metadata = {
  title: 'My profile',
  robots: { index: false, follow: false },
};

export default function CustomerProfileRoute() {
  return <CustomerProfilePage />;
}

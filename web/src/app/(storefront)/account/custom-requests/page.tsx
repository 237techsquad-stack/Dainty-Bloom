import type { Metadata } from 'next';
import { CustomRequestHistory } from '@/components/contact/CustomRequestHistory';

export const metadata: Metadata = {
  title: 'My custom requests',
  robots: { index: false, follow: false },
};

export default function CustomerCustomRequestsRoute() {
  return <CustomRequestHistory />;
}

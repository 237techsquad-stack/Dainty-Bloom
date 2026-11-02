import type { Metadata } from 'next';
import { AdminArtworkReview } from '@/components/admin/AdminArtworkReview';

export const metadata: Metadata = {
  title: 'Artwork review',
  robots: { index: false, follow: false },
};

export default function AdminArtworkPage() {
  return <AdminArtworkReview />;
}

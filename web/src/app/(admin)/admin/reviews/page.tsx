import type { Metadata } from 'next';
import { AdminReviewsManagement } from '@/components/admin/AdminPeopleManagement';

export const metadata: Metadata = {
  title: 'Reviews',
  robots: { index: false, follow: false },
};

export default function AdminReviewsPage() {
  return <AdminReviewsManagement />;
}

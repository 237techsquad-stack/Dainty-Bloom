import type { Metadata } from 'next';
import { AdminAboutMediaManagement } from '@/components/admin/AdminAboutMediaManagement';

export const metadata: Metadata = {
  title: 'About media',
  robots: { index: false, follow: false },
};

export default function AdminAboutMediaPage() {
  return <AdminAboutMediaManagement />;
}

import type { Metadata } from 'next';
import { AdminSettingsManagement } from '@/components/admin/AdminSettingsManagement';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default function AdminSettingsPage() {
  return <AdminSettingsManagement />;
}

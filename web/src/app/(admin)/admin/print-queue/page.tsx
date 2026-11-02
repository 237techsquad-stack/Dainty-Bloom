import type { Metadata } from 'next';
import { AdminPrintQueueManagement } from '@/components/admin/AdminPrintQueueManagement';

export const metadata: Metadata = {
  title: 'Print queue',
  robots: { index: false, follow: false },
};

export default function AdminPrintQueuePage() {
  return <AdminPrintQueueManagement />;
}

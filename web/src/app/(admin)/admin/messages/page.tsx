import type { Metadata } from 'next';
import { AdminMessagesManagement } from '@/components/admin/AdminMessagesManagement';

export const metadata: Metadata = { title: 'Messages' };

export default function AdminMessagesPage() {
  return <AdminMessagesManagement />;
}

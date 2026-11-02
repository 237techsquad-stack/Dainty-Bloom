import type { Metadata } from 'next';
import { AdminStaffManagement } from '@/components/admin/AdminPeopleManagement';

export const metadata: Metadata = {
  title: 'Staff',
  robots: { index: false, follow: false },
};

export default function AdminStaffPage() {
  return <AdminStaffManagement />;
}

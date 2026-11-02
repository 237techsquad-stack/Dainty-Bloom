import type { Metadata } from 'next';
import { Dashboard } from '@/components/admin/Dashboard';

export const metadata: Metadata = {
  title: 'Admin dashboard',
  robots: { index: false, follow: false },
};

export default function AdminDashboardPage() {
  return <Dashboard />;
}

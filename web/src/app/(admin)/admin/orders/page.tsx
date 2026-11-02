import type { Metadata } from 'next';
import { AdminOrdersManagement } from '@/components/admin/AdminOrdersManagement';

export const metadata: Metadata = {
  title: 'Orders',
  robots: { index: false, follow: false },
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialQuery = Array.isArray(params.q)
    ? (params.q[0] ?? '')
    : (params.q ?? '');
  return <AdminOrdersManagement initialQuery={initialQuery} />;
}

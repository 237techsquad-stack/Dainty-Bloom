import type { Metadata } from 'next';
import { AdminCustomersManagement } from '@/components/admin/AdminPeopleManagement';

export const metadata: Metadata = {
  title: 'Customers',
  robots: { index: false, follow: false },
};

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialQuery = Array.isArray(params.q)
    ? (params.q[0] ?? '')
    : (params.q ?? '');
  return <AdminCustomersManagement initialQuery={initialQuery} />;
}

import type { Metadata } from 'next';
import { AdminOrderDetailManagement } from '@/components/admin/AdminOrderDetailManagement';

export const metadata: Metadata = {
  title: 'Order details',
  robots: { index: false, follow: false },
};

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminOrderDetailManagement orderId={id} />;
}

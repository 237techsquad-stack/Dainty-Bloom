import type { Metadata } from 'next';
import { AdminPrintJobDetailManagement } from '@/components/admin/AdminPrintJobDetailManagement';

export const metadata: Metadata = {
  title: 'Print job details',
  robots: { index: false, follow: false },
};

export default async function AdminPrintJobPage({
  params,
}: {
  params: Promise<{ orderId: string; itemId: string }>;
}) {
  const { orderId, itemId } = await params;
  return (
    <AdminPrintJobDetailManagement orderId={orderId} itemId={itemId} />
  );
}

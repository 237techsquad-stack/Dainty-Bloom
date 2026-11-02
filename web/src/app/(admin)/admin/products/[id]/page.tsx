import type { Metadata } from 'next';
import { ProductEditor } from '@/components/admin/ProductEditor';

export const metadata: Metadata = {
  title: 'Edit product',
  robots: { index: false, follow: false },
};

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductEditor productId={id} />;
}

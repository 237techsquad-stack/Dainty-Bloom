import type { Metadata } from 'next';
import { ProductEditor } from '@/components/admin/ProductEditor';

export const metadata: Metadata = {
  title: 'Add product',
  robots: { index: false, follow: false },
};

export default function NewProductPage() {
  return <ProductEditor />;
}

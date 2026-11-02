import type { Metadata } from 'next';
import { ProductsManagement } from '@/components/admin/ProductsManagement';

export const metadata: Metadata = {
  title: 'Products',
  robots: { index: false, follow: false },
};

export default function ProductsPage() {
  return <ProductsManagement />;
}

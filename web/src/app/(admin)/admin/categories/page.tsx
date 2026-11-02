import type { Metadata } from 'next';
import { CategoriesManagement } from '@/components/admin/CategoriesManagement';

export const metadata: Metadata = {
  title: 'Categories',
  robots: { index: false, follow: false },
};

export default function CategoriesPage() {
  return <CategoriesManagement />;
}

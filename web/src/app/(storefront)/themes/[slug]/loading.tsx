import { CatalogSkeleton } from '@/components/catalog/CatalogComponents';

export default function ThemeLoading() {
  return (
    <div className="container catalog-page">
      <div className="skeleton loading-title" />
      <div className="catalog-layout">
        <div />
        <CatalogSkeleton />
      </div>
    </div>
  );
}

import { CatalogSkeleton } from '@/components/catalog/CatalogComponents';

export default function ProductLoading() {
  return <div className="container product-page"><div className="skeleton loading-title" /><div className="product-detail-layout"><div className="skeleton product-loading-image" /><div className="product-purchase"><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line skeleton-line--wide" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line skeleton-line--wide" /></div></div><CatalogSkeleton count={4} /></div>;
}

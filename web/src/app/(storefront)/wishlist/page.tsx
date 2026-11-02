'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Heart, Trash2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useWishlist } from '@/hooks/useWishlist';
import {
  ProductCard,
  ErrorStateCatalog,
  CatalogSkeleton,
  EmptyStateCatalog,
} from '@/components/catalog/CatalogComponents';
import { Button } from '@/components/ui';

export default function WishlistPage() {
  const query = useQuery({ queryKey: ['wishlist'], queryFn: api.wishlist });
  const wishlist = useWishlist();

  if (query.isPending)
    return (
      <div className="container wishlist-page">
        <div className="skeleton loading-title" />
        <CatalogSkeleton count={4} />
      </div>
    );
  if (query.isError)
    return (
      <div className="container wishlist-page">
        <ErrorStateCatalog
          retry={() => void query.refetch()}
          title="Your wishlist could not be loaded"
        />
      </div>
    );

  return (
    <div className="container wishlist-page">
      <header className="catalog-heading">
        <div>
          <span className="eyebrow">Saved for later</span>
          <h1>Your wishlist</h1>
        </div>
      </header>
      {query.data.removedCount > 0 ? (
        <p className="wishlist-note" role="status">
          {query.data.removedCount} unavailable{' '}
          {query.data.removedCount === 1 ? 'product was' : 'products were'}{' '}
          removed from your wishlist.
        </p>
      ) : null}
      {query.data.products.length ? (
        <div className="wishlist-grid">
          {query.data.products.map((product) => (
            <div className="wishlist-item" key={product.id}>
              <ProductCard product={product} />
              <Button
                variant="ghost"
                onClick={() => wishlist.toggle(product)}
                aria-label={`Remove ${product.title} from wishlist`}
              >
                <Trash2 size={16} /> Remove
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyStateCatalog
          title="Your wishlist is empty"
          action={
            <Link className="button button--primary" href="/shop">
              <Heart size={16} /> Browse the shop
            </Link>
          }
        />
      )}
    </div>
  );
}

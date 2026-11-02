'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Box,
  Check,
  Heart,
  LoaderCircle,
  Palette,
  Shirt,
  Sparkles,
  Coffee,
  Star,
  Sun,
  Moon,
} from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import type { CatalogCard } from '@/lib/api/types';
import { useWishlist } from '@/hooks/useWishlist';
import { formatMoney } from '@/lib/utils/formatMoney';
import { getProductImageAlt } from '@/lib/productImageAlt';
import { Button, PriceDisplay } from '@/components/ui';

export function StarRating({
  rating,
  count,
  input = false,
  onChange,
  value = 0,
}: {
  rating?: number | null;
  count?: number;
  input?: boolean;
  onChange?: (rating: number) => void;
  value?: number;
}) {
  if (input) {
    function handleRatingKeyDown(
      event: KeyboardEvent<HTMLButtonElement>,
      score: number,
    ) {
      const keys = [
        'ArrowRight',
        'ArrowDown',
        'ArrowLeft',
        'ArrowUp',
        'Home',
        'End',
      ];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const nextScore =
        event.key === 'Home'
          ? 1
          : event.key === 'End'
            ? 5
            : event.key === 'ArrowRight' || event.key === 'ArrowDown'
              ? (score % 5) + 1
              : ((score + 3) % 5) + 1;
      const radios =
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
          '[role="radio"]',
        );
      onChange?.(nextScore);
      radios?.[nextScore - 1]?.focus();
    }

    return (
      <div
        className="star-rating-input"
        role="radiogroup"
        aria-label="Your rating"
      >
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            aria-label={`${score} ${score === 1 ? 'star' : 'stars'}`}
            aria-checked={value === score}
            tabIndex={value === score || (value === 0 && score === 1) ? 0 : -1}
            key={score}
            onClick={() => onChange?.(score)}
            onKeyDown={(event) => handleRatingKeyDown(event, score)}
            role="radio"
            type="button"
          >
            <Star
              aria-hidden="true"
              fill={score <= value ? 'currentColor' : 'none'}
            />
          </button>
        ))}
      </div>
    );
  }
  if (rating == null) return null;
  const reviewCount = count ?? 0;
  return (
    <span
      className="star-rating"
      aria-label={
        reviewCount > 0
          ? `Rated ${rating.toFixed(1)} out of 5 from ${reviewCount} reviews`
          : `Rated ${rating.toFixed(1)} out of 5`
      }
    >
      <Star aria-hidden="true" size={15} fill="currentColor" />
      <span>{rating.toFixed(1)}</span>
      {reviewCount > 0 ? <span className="muted">({reviewCount})</span> : null}
    </span>
  );
}

export function AvailabilityBadge({
  availability,
}: {
  availability: CatalogCard['availability'];
}) {
  const label: Record<CatalogCard['availability'], string> = {
    in_stock: 'In stock',
    low_stock: 'Low stock',
    out_of_stock: 'Out of stock',
    made_to_order: 'Made to order',
  };
  const Icon = availability === 'in_stock' ? Check : AlertCircle;
  return (
    <span className={`availability availability--${availability}`}>
      <Icon aria-hidden="true" size={14} /> {label[availability]}
    </span>
  );
}

export function WishlistToggle({
  product,
  compact = false,
}: {
  product: CatalogCard;
  compact?: boolean;
}) {
  const wishlist = useWishlist();
  const saved = wishlist.isSaved(product.id);
  return (
    <button
      className={`wishlist-toggle${compact ? ' wishlist-toggle--compact' : ''}${saved ? ' is-saved' : ''}`}
      type="button"
      aria-pressed={saved}
      aria-label={`${saved ? 'Remove from' : 'Add to'} wishlist: ${product.title}`}
      disabled={wishlist.isPending}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        wishlist.toggle(product);
      }}
    >
      <Heart aria-hidden="true" fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}

export function ProductCard({
  product,
  lightingState,
}: {
  product: CatalogCard;
  lightingState?: 'on' | 'off';
}) {
  const [hover, setHover] = useState(false);
  const canSwitchLighting = Boolean(
    product.lightingImages?.on && product.lightingImages.off,
  );
  const lightingImages =
    canSwitchLighting && lightingState
      ? product.lightingImages?.[lightingState]
      : undefined;
  const primaryImage = lightingImages?.primary ?? product.primaryImage;
  const secondaryImage = lightingImages
    ? lightingImages.secondary
    : product.secondaryImage;
  const sale =
    product.compareAtPriceMinor !== undefined &&
    product.compareAtPriceMinor > product.startingPriceMinor;
  return (
    <article
      className="product-card"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
    >
      <Link
        href={`/product/${encodeURIComponent(product.slug)}`}
        aria-label={`View product: ${product.title}`}
        className="product-card__main-link"
      >
        <div className="product-card__image">
          {primaryImage ? (
            <>
              <Image
                src={primaryImage.variants.medium || primaryImage.url}
                alt={getProductImageAlt(product.title, primaryImage.alt)}
                fill
                sizes="(max-width: 479px) 46vw, (max-width: 767px) 46vw, (max-width: 1023px) 31vw, (max-width: 1279px) 23vw, 280px"
                className={`product-card__photo${hover && secondaryImage ? ' is-hidden' : ''}`}
              />
              {secondaryImage ? (
                <Image
                  src={secondaryImage.variants.medium || secondaryImage.url}
                  alt={getProductImageAlt(product.title, secondaryImage.alt)}
                  fill
                  sizes="(max-width: 479px) 46vw, (max-width: 767px) 46vw, (max-width: 1023px) 31vw, (max-width: 1279px) 23vw, 280px"
                  className={`product-card__photo product-card__photo--second${hover ? ' is-visible' : ''}`}
                />
              ) : null}
            </>
          ) : (
            <span
              className="product-image-placeholder"
              aria-label="No product image available"
            >
              <Box aria-hidden="true" />
            </span>
          )}
          <div className="product-card__badges">
            {product.madeToOrder || product.availability === 'made_to_order' ? (
              <span>
                <Check size={13} /> Made to order
              </span>
            ) : null}
            {product.availability === 'low_stock' ? (
              <span>
                <AlertCircle size={13} /> Low stock
              </span>
            ) : null}
            {product.availability === 'out_of_stock' ? (
              <span>
                <AlertCircle size={13} /> Out of stock
              </span>
            ) : null}
            {sale ? (
              <span>
                <Sparkles size={13} /> Sale
              </span>
            ) : null}
          </div>
        </div>
        <div className="product-card__body">
          <div className="product-card__summary">
            <span className="product-card__summary-title">{product.title}</span>
            <PriceDisplay
              amountMinor={product.startingPriceMinor}
              currency={product.currency}
              compareAtMinor={product.compareAtPriceMinor}
            />
            <ArrowRight
              className="product-card__arrow"
              aria-hidden="true"
              size={16}
            />
          </div>
          {product.description?.trim() ? (
            <p className="product-card__description">{product.description}</p>
          ) : null}
        </div>
      </Link>
      <WishlistToggle product={product} compact />
    </article>
  );
}

export function ProductGrid({
  products,
  lightingState,
}: {
  products: CatalogCard[];
  lightingState?: 'on' | 'off';
}) {
  return (
    <div className="product-grid">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          lightingState={lightingState}
        />
      ))}
    </div>
  );
}

export function hasCompleteLightingImagePair(
  products: readonly CatalogCard[],
): boolean {
  return products.some((product) =>
    Boolean(product.lightingImages?.on && product.lightingImages.off),
  );
}

export function LightingStateToggle({
  value,
  onChange,
}: {
  value: 'on' | 'off';
  onChange: (value: 'on' | 'off') => void;
}) {
  return (
    <div
      className="lighting-state-toggle"
      role="group"
      aria-label="Lamp lighting images"
    >
      <button
        className={value === 'on' ? 'is-selected' : ''}
        type="button"
        aria-pressed={value === 'on'}
        onClick={() => onChange('on')}
      >
        <Sun aria-hidden="true" size={15} />
        Light On
      </button>
      <button
        className={value === 'off' ? 'is-selected' : ''}
        type="button"
        aria-pressed={value === 'off'}
        onClick={() => onChange('off')}
      >
        <Moon aria-hidden="true" size={15} />
        Light Off
      </button>
    </div>
  );
}

export function EmptyStateCatalog({
  title,
  children,
  action,
  variant = 'default',
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  variant?: 'default' | 'plain';
}) {
  return (
    <div
      className={`catalog-state${
        variant === 'plain' ? ' catalog-state--plain' : ''
      }`}
    >
      <Box aria-hidden="true" />
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorStateCatalog({
  retry,
  title = 'We could not load this part of the shop',
}: {
  retry?: () => void;
  title?: string;
}) {
  return (
    <div className="catalog-state catalog-state--error" role="alert">
      <AlertCircle aria-hidden="true" />
      <h2>{title}</h2>
      <p>Please try again.</p>
      {retry ? (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function CatalogSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="product-grid"
      aria-label="Loading products"
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="product-card product-card--skeleton" key={index}>
          <div className="skeleton product-card__image" />
          <div className="product-card__body">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line skeleton-line--wide" />
            <div className="skeleton skeleton-line skeleton-line--short" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages < 2) return null;
  const pages = Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    return start + index;
  });
  return (
    <nav className="catalog-pagination" aria-label="Pagination">
      <button
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        <ArrowDown size={15} className="rotate-90" />
        Previous
      </button>
      {pages.map((number) => (
        <button
          key={number}
          aria-current={number === page ? 'page' : undefined}
          onClick={() => onChange(number)}
        >
          {number}
        </button>
      ))}
      <button
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        Next
        <ArrowUp size={15} className="rotate-90" />
      </button>
    </nav>
  );
}

export function ProductLineIcon({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const Icon = normalized.includes('3d')
    ? Box
    : normalized.includes('paint') || normalized.includes('canvas')
      ? Palette
      : normalized.includes('mug')
        ? Coffee
        : normalized.includes('shirt') || normalized.includes('t-shirt')
          ? Shirt
          : Sparkles;
  return <Icon aria-hidden="true" />;
}

export function LoadingIcon() {
  return <LoaderCircle className="spin" aria-label="Loading" />;
}

export function formatProductPrice(amountMinor: number, currency: string) {
  return formatMoney(amountMinor, currency);
}

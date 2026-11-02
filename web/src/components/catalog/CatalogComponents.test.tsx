import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { CatalogCard } from '@/lib/api/types';
import {
  hasCompleteLightingImagePair,
  LightingStateToggle,
  ProductCard,
  ProductGrid,
} from './CatalogComponents';

vi.mock('next/image', () => ({
  default: ({
    alt,
    className,
    src,
  }: {
    alt: string;
    className?: string;
    src: string;
  }) => createElement('img', { alt, className, src }),
}));

vi.mock('next/link', () => ({
  default: ({
    'aria-label': ariaLabel,
    children,
    className,
    href,
  }: {
    'aria-label'?: string;
    children: ReactNode;
    className?: string;
    href: string;
  }) => (
    <a aria-label={ariaLabel} className={className} href={href}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/useWishlist', () => ({
  useWishlist: () => ({
    isPending: false,
    isSaved: () => false,
    toggle: vi.fn(),
  }),
}));

vi.mock('@/components/ui', () => ({
  Button: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  PriceDisplay: () => <span>£10.00</span>,
}));

afterEach(cleanup);

function card(overrides: Partial<CatalogCard> = {}): CatalogCard {
  return {
    id: 'lamp-card',
    title: 'Lamp',
    slug: 'lamp',
    primaryImage: {
      url: '/lamp-default.jpg',
      alt: 'Lamp default',
      variants: {
        thumb: '/lamp-default-thumb.jpg',
        medium: '/lamp-default-medium.jpg',
        large: '/lamp-default-large.jpg',
      },
    },
    category: {
      id: 'lighting',
      name: 'Lamps and Lighting',
      slug: 'lamps-and-lighting',
    },
    productType: 'three_d_printed',
    startingPriceMinor: 1000,
    currency: 'GBP',
    availability: 'in_stock',
    isFeatured: false,
    customizationCues: [],
    ...overrides,
  };
}

function lightingSet(prefix: string) {
  return {
    primary: {
      url: `/${prefix}.jpg`,
      alt: `${prefix} view`,
      variants: {
        thumb: `/${prefix}-thumb.jpg`,
        medium: `/${prefix}-medium.jpg`,
        large: `/${prefix}-large.jpg`,
      },
    },
  };
}

function LightingCards() {
  const [lightingState, setLightingState] = useState<'on' | 'off'>('on');
  const products = [
    card({
      id: 'pair-one',
      title: 'Pair one',
      lightingImages: {
        on: lightingSet('one-on'),
        off: lightingSet('one-off'),
      },
    }),
    card({
      id: 'pair-two',
      title: 'Pair two',
      lightingImages: {
        on: lightingSet('two-on'),
        off: lightingSet('two-off'),
      },
    }),
    card({
      id: 'incomplete',
      title: 'Incomplete pair',
      primaryImage: {
        url: '/incomplete-default.jpg',
        alt: 'Incomplete default',
        variants: {
          thumb: '/incomplete-default-thumb.jpg',
          medium: '/incomplete-default-medium.jpg',
          large: '/incomplete-default-large.jpg',
        },
      },
      lightingImages: { on: lightingSet('incomplete-on') },
    }),
  ];

  return (
    <>
      <LightingStateToggle value={lightingState} onChange={setLightingState} />
      <ProductGrid products={products} lightingState={lightingState} />
    </>
  );
}

describe('catalog card descriptions', () => {
  it('omits empty descriptions and visually clamps full descriptions', () => {
    const { rerender, container } = render(<ProductCard product={card()} />);
    expect(container.querySelector('.product-card__description')).toBeNull();

    rerender(<ProductCard product={card({ description: '' })} />);
    expect(container.querySelector('.product-card__description')).toBeNull();

    rerender(<ProductCard product={card({ description: '   ' })} />);
    expect(container.querySelector('.product-card__description')).toBeNull();

    const longDescription =
      'A complete long description that must remain intact while the card preview is visually clamped.';
    rerender(<ProductCard product={card({ description: longDescription })} />);
    const preview = container.querySelector('.product-card__description');
    expect(preview?.textContent).toBe(longDescription);
    expect(preview?.className).toContain('product-card__description');
    const styles = readFileSync(
      resolve(process.cwd(), 'src/styles/catalog.css'),
      'utf8',
    );
    expect(styles).toMatch(
      /\.product-card__description\s*\{[^}]*-webkit-line-clamp:\s*3/,
    );
  });
});

describe('category-wide lighting cards', () => {
  it('requires a complete pair and changes every paired card while leaving incomplete cards unchanged', () => {
    const incomplete = card({
      lightingImages: { on: lightingSet('on-only') },
    });
    expect(hasCompleteLightingImagePair([incomplete])).toBe(false);
    expect(
      hasCompleteLightingImagePair([
        incomplete,
        card({
          lightingImages: {
            on: lightingSet('paired-on'),
            off: lightingSet('paired-off'),
          },
        }),
      ]),
    ).toBe(true);

    render(<LightingCards />);
    expect(screen.getByAltText('one-on view').getAttribute('src')).toBe(
      '/one-on-medium.jpg',
    );
    expect(screen.getByAltText('two-on view').getAttribute('src')).toBe(
      '/two-on-medium.jpg',
    );
    expect(screen.getByAltText('Incomplete default').getAttribute('src')).toBe(
      '/incomplete-default-medium.jpg',
    );

    fireEvent.click(screen.getByRole('button', { name: /light off/i }));
    expect(
      screen
        .getByRole('button', { name: /light off/i })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByAltText('one-off view').getAttribute('src')).toBe(
      '/one-off-medium.jpg',
    );
    expect(screen.getByAltText('two-off view').getAttribute('src')).toBe(
      '/two-off-medium.jpg',
    );
    expect(screen.getByAltText('Incomplete default').getAttribute('src')).toBe(
      '/incomplete-default-medium.jpg',
    );
  });
});

describe('responsive product detail content structure', () => {
  it('renders the description and review panel once outside mobile accordions', () => {
    const detailSource = readFileSync(
      resolve(process.cwd(), 'src/components/catalog/ProductDetailClient.tsx'),
      'utf8',
    );
    const styles = readFileSync(
      resolve(process.cwd(), 'src/styles/catalog.css'),
      'utf8',
    );
    expect(detailSource.match(/id="description"/g)).toHaveLength(1);
    expect(detailSource.match(/<ReviewsPanel /g)).toHaveLength(1);
    expect(detailSource).not.toContain('<Accordion title="Description">');
    expect(detailSource).not.toContain('<Accordion title="Reviews">');
    expect(detailSource).toMatch(/<\/div>\s*<section\s+id="reviews"/);
    expect(detailSource.indexOf('id="description"')).toBeLessThan(
      detailSource.indexOf('className="product-information"'),
    );
    expect(styles).toContain('.product-description-section {');
    expect(styles).toContain('.product-information > .product-info-section {');
  });
});

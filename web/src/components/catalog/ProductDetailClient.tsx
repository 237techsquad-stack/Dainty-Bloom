'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileImage,
  Leaf,
  LoaderCircle,
  ShoppingBag,
  Upload,
  X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CatalogCard, PublicProduct } from '@/lib/api/types';
import type { SiteSettings } from '@/lib/api/types';
import {
  Accordion,
  Button,
  Modal,
  QuantityStepper,
  useToast,
} from '@/components/ui';
import { api, ApiError, uploadArtwork } from '@/lib/api/client';
import { useSettings } from '@/hooks/useSettings';
import { formatMoney } from '@/lib/utils/formatMoney';
import { getProductImageAlt } from '@/lib/productImageAlt';
import {
  AvailabilityBadge,
  ProductGrid,
  StarRating,
  WishlistToggle,
} from './CatalogComponents';
import { ReviewsPanel } from './ReviewsPanel';

type SelectedOptions = Record<string, string>;
export type Artwork = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  preview?: string;
};

function selectedAsArray(
  groups: PublicProduct['optionGroups'],
  selected: SelectedOptions,
) {
  return groups.flatMap((group) =>
    selected[group.key] ? [{ key: group.key, value: selected[group.key] }] : [],
  );
}

function formatBytes(bytes: number) {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function friendlyUploadError(error: unknown) {
  if (!(error instanceof ApiError))
    return 'The artwork could not be uploaded. Please try again.';
  const messages: Record<string, string> = {
    FILE_TOO_LARGE: 'This file is larger than the allowed upload size.',
    FILE_TYPE_NOT_ALLOWED: 'This file type is not accepted for artwork.',
    FILE_CORRUPT:
      'The file could not be read. Please choose a valid artwork file.',
  };
  return messages[error.code] ?? error.message;
}

export function ProductDetailClient({
  product,
  initialSettings,
  showReviews = true,
  showStickyBar = true,
}: {
  product: PublicProduct;
  initialSettings: SiteSettings | null;
  showReviews?: boolean;
  showStickyBar?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useSettings(initialSettings);
  const galleryRef = useRef<HTMLDivElement>(null);
  const allImages = useMemo(
    () =>
      [...(Array.isArray(product.media) ? product.media : [])].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      ),
    [product.media],
  );
  const lightingGalleryEnabled = product.lightingGalleryEnabled === true;
  const onImages = useMemo(
    () => allImages.filter((image) => image.lightingState === 'on'),
    [allImages],
  );
  const offImages = useMemo(
    () => allImages.filter((image) => image.lightingState === 'off'),
    [allImages],
  );
  const [lightingState, setLightingState] = useState<'on' | 'off'>(() =>
    onImages.length ? 'on' : 'off',
  );
  const images = useMemo(
    () =>
      lightingGalleryEnabled
        ? lightingState === 'on'
          ? onImages
          : offImages
        : allImages,
    [allImages, lightingGalleryEnabled, lightingState, offImages, onImages],
  );
  const [activeImage, setActiveImage] = useState(() => {
    if (!lightingGalleryEnabled) return allImages.length ? 0 : null;
    const initialImages = onImages.length ? onImages : offImages;
    if (!initialImages.length) return null;
    const primaryIndex = initialImages.findIndex((image) => image.isPrimary);
    return primaryIndex >= 0 ? primaryIndex : 0;
  });
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [mainButtonVisible, setMainButtonVisible] = useState(true);
  const [selected, setSelected] = useState<SelectedOptions>(() =>
    Object.fromEntries(
      product.optionGroups
        .filter((group) => group.required && group.values.length === 1)
        .map((group) => [group.key, group.values[0]?.value ?? '']),
    ),
  );
  const [quantity, setQuantity] = useState(product.minOrderQuantity ?? 1);
  const [debouncedQuantity, setDebouncedQuantity] = useState(quantity);
  const [debouncedOptions, setDebouncedOptions] = useState(selected);
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [cartError, setCartError] = useState('');
  const [adding, setAdding] = useState(false);

  const optionsArray = selectedAsArray(product.optionGroups, debouncedOptions);
  const quoteInputsAreCurrent =
    quantity === debouncedQuantity &&
    product.optionGroups.every(
      (group) => selected[group.key] === debouncedOptions[group.key],
    );
  const requiredOptionsComplete = product.optionGroups.every(
    (group) => !group.required || Boolean(debouncedOptions[group.key]),
  );
  const quote = useQuery({
    queryKey: ['product-quote', product.slug, optionsArray, debouncedQuantity],
    queryFn: () =>
      api.quote(product.slug, {
        selectedOptions: optionsArray,
        quantity: debouncedQuantity,
      }),
    enabled: requiredOptionsComplete,
    staleTime: 0,
  });
  const quotePrice = quote.data?.unitPriceMinor;
  const needsArtwork =
    product.artworkRequired ||
    Boolean(
      product.artworkRequirements.allowedFormats.length ||
      product.artworkRequirements.notes ||
      product.artworkRequirements.minimumResolutionNote,
    );
  const artworkReady = !product.artworkRequired || Boolean(artwork);
  const isUnavailable =
    product.availability === 'out_of_stock' ||
    quote.data?.availability === 'out_of_stock';
  const canAdd =
    requiredOptionsComplete &&
    artworkReady &&
    quotePrice !== null &&
    quotePrice !== undefined &&
    quoteInputsAreCurrent &&
    !quote.isFetching &&
    !quote.isError &&
    !quote.data?.issues.length &&
    !isUnavailable;
  const wishlistImage =
    allImages.find((image) => image.isPrimary) ?? allImages[0];
  const wishlistCard: CatalogCard = {
    id: product.id,
    title: product.title,
    slug: product.slug,
    primaryImage: wishlistImage
      ? {
          url: wishlistImage.url,
          alt: wishlistImage.alt,
          variants: wishlistImage.variants!,
        }
      : null,
    category: product.category,
    productType: product.productType,
    startingPriceMinor: product.basePriceMinor,
    compareAtPriceMinor: product.compareAtPriceMinor,
    currency: product.currency,
    availability: product.availability,
    ratingAverage: product.ratingAverage,
    ratingCount: product.ratingCount,
    isFeatured: product.isFeatured,
    customizationCues: [],
    ecoNote: product.ecoNote,
    madeToOrder: product.madeToOrder,
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedOptions(selected), 250);
    return () => window.clearTimeout(timer);
  }, [selected]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuantity(quantity), 250);
    return () => window.clearTimeout(timer);
  }, [quantity]);

  useEffect(() => {
    const node = document.querySelector<HTMLButtonElement>(
      '.product-add-button',
    );
    if (!node || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setMainButtonVisible(entry.isIntersecting);
      },
      { threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (artwork?.preview) URL.revokeObjectURL(artwork.preview);
    },
    [artwork?.preview],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!lightboxOpen || !images.length) return;
      if (event.key === 'ArrowRight')
        setActiveImage((index) => ((index ?? 0) + 1) % images.length);
      if (event.key === 'ArrowLeft')
        setActiveImage(
          (index) => ((index ?? 0) - 1 + images.length) % images.length,
        );
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [images.length, lightboxOpen]);

  useLayoutEffect(() => {
    if (!lightingGalleryEnabled) return;
    const carousel = galleryRef.current;
    if (!carousel || window.innerWidth >= 768) return;
    const stateImages = lightingState === 'on' ? onImages : offImages;
    const primaryIndex = stateImages.findIndex((image) => image.isPrimary);
    carousel.scrollLeft =
      (primaryIndex >= 0 ? primaryIndex : 0) * carousel.clientWidth;
  }, [lightingGalleryEnabled, lightingState, offImages, onImages]);

  async function onArtworkFile(file: File | undefined) {
    if (!file) return;
    setUploadError('');
    const limits = settings.data?.artwork;
    if (limits && file.size > limits.maxBytes) {
      setUploadError(
        `Choose a file no larger than ${formatBytes(limits.maxBytes)}.`,
      );
      return;
    }
    if (limits && file.type && !limits.allowedMimeTypes.includes(file.type)) {
      setUploadError('This file type is not accepted for artwork.');
      return;
    }
    const previousArtwork = artwork;
    setUploadProgress(0);
    try {
      const uploaded = await uploadArtwork(file, setUploadProgress);
      const preview =
        uploaded.detectedMimeType.startsWith('image/') &&
        uploaded.detectedMimeType !== 'image/svg+xml'
          ? URL.createObjectURL(file)
          : undefined;
      setArtwork({
        id: uploaded.id,
        name: uploaded.originalFilename,
        mime: uploaded.detectedMimeType,
        sizeBytes: uploaded.sizeBytes,
        preview,
      });
      if (previousArtwork) {
        if (previousArtwork.preview)
          URL.revokeObjectURL(previousArtwork.preview);
        await api.removeArtwork(previousArtwork.id);
      }
    } catch (error) {
      setUploadError(friendlyUploadError(error));
    } finally {
      setUploadProgress(null);
    }
  }

  async function removeUploadedArtwork() {
    if (!artwork) return;
    try {
      await api.removeArtwork(artwork.id);
      if (artwork.preview) URL.revokeObjectURL(artwork.preview);
      setArtwork(null);
    } catch {
      setUploadError(
        'The uploaded artwork could not be removed. Please try again.',
      );
    }
  }

  async function addToCart(buyNow = false) {
    if (!canAdd) return;
    setAdding(true);
    setCartError('');
    try {
      await api.addCartItem({
        productId: product.id,
        selectedOptions: selectedAsArray(product.optionGroups, selected),
        quantity,
        ...(artwork ? { artworkId: artwork.id } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['cart-summary'] });
      toast(`${product.title} added to your cart.`, 'success');
      window.dispatchEvent(new Event('cart:open'));
      if (buyNow) router.push('/cart');
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      const messages: Record<string, string> = {
        INVALID_OPTION_SELECTION: 'Please check your product options.',
        INSUFFICIENT_STOCK: 'The selected quantity is not currently available.',
        INVALID_QUANTITY: 'This quantity is outside the allowed order range.',
        PRODUCT_UNAVAILABLE: 'This product is no longer available.',
        ARTWORK_REQUIRED:
          'Upload the required artwork before adding this product.',
      };
      setCartError(
        messages[code] ??
          (error instanceof ApiError
            ? error.message
            : 'The product could not be added.'),
      );
    } finally {
      setAdding(false);
    }
  }

  function selectImage(index: number) {
    if (index < 0 || index >= images.length) return;
    setActiveImage(index);
    const node = galleryRef.current?.querySelectorAll<HTMLElement>(
      '[data-gallery-image]',
    )[index];
    node?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }

  function selectLightingState(state: 'on' | 'off') {
    const nextImages = state === 'on' ? onImages : offImages;
    if (!nextImages.length) return;
    const primaryIndex = nextImages.findIndex((image) => image.isPrimary);
    setLightingState(state);
    setActiveImage(primaryIndex >= 0 ? primaryIndex : 0);
  }

  const selectedImageIndex =
    activeImage !== null && activeImage >= 0 && activeImage < images.length
      ? activeImage
      : images.length
        ? 0
        : null;
  const mainImage =
    selectedImageIndex === null ? undefined : images[selectedImageIndex];
  const priceLabel =
    !quoteInputsAreCurrent || quote.isFetching
      ? 'Checking price…'
      : quotePrice === null || quotePrice === undefined
        ? requiredOptionsComplete
          ? 'Price unavailable'
          : 'Choose options to see price'
        : formatMoney(quotePrice, quote.data?.currency ?? product.currency);

  return (
    <div className="product-page container">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumbs">
          <li>
            <Link href="/">Home</Link>
          </li>
          {product.breadcrumb.map((crumb) => (
            <li key={crumb.id}>
              <Link href={`/category/${crumb.slug}`}>{crumb.name}</Link>
            </li>
          ))}
          <li>
            <span aria-current="page">{product.title}</span>
          </li>
        </ol>
      </nav>

      <div className="product-detail-layout">
        <section className="product-gallery" aria-label="Product images">
          {lightingGalleryEnabled ? (
            <div
              className="product-gallery__lighting"
              role="group"
              aria-label="Choose lighting view"
            >
              <span>Lighting view</span>
              <button
                type="button"
                aria-pressed={lightingState === 'on'}
                disabled={!onImages.length}
                onClick={() => selectLightingState('on')}
              >
                Light ON
              </button>
              <button
                type="button"
                aria-pressed={lightingState === 'off'}
                disabled={!offImages.length}
                onClick={() => selectLightingState('off')}
              >
                Light OFF
              </button>
            </div>
          ) : null}
          <div
            className="product-gallery__thumbs"
            aria-label="Choose product image"
          >
            {images.map((image, index) => (
              <button
                className={index === selectedImageIndex ? 'is-active' : ''}
                key={`${image.url}-${index}`}
                onClick={() => selectImage(index)}
                aria-label={`Show image ${index + 1}: ${image.alt}`}
                aria-pressed={index === selectedImageIndex}
              >
                <Image
                  src={image.variants?.thumb ?? image.url}
                  alt=""
                  fill
                  sizes="72px"
                />
              </button>
            ))}
          </div>
          <div
            className="product-gallery__carousel"
            ref={galleryRef}
            onScroll={(event) => {
              if (window.innerWidth >= 768) return;
              const width = event.currentTarget.clientWidth;
              if (width > 0 && images.length) {
                const index = Math.round(
                  event.currentTarget.scrollLeft / width,
                );
                setActiveImage(Math.max(0, Math.min(images.length - 1, index)));
              }
            }}
          >
            {images.length ? (
              images.map((image, index) => (
                <button
                  className="product-gallery__main"
                  data-gallery-image
                  data-active={index === selectedImageIndex}
                  key={`${image.url}-main-${index}`}
                  onClick={() => {
                    setActiveImage(index);
                    setLightboxOpen(true);
                  }}
                  aria-label={`Open image ${index + 1} in full screen`}
                >
                  <Image
                    src={image.variants?.large ?? image.url}
                    alt={getProductImageAlt(product.title, image.alt)}
                    fill
                    sizes="(max-width: 767px) 100vw, (max-width: 1023px) 70vw, 55vw"
                    priority={index === 0}
                    loading={index === 0 ? 'eager' : 'lazy'}
                  />
                </button>
              ))
            ) : (
              <div
                className="product-gallery__main product-image-placeholder"
                role="img"
                aria-label="No product image available"
              >
                <ShoppingBag />
              </div>
            )}
          </div>
          {images.length > 1 && selectedImageIndex !== null ? (
            <div className="product-gallery__mobile-controls">
              <button
                aria-label="Previous image"
                onClick={() =>
                  selectImage(
                    (selectedImageIndex - 1 + images.length) % images.length,
                  )
                }
              >
                <ArrowLeft />
              </button>
              <span>
                {selectedImageIndex + 1} / {images.length}
              </span>
              <div className="gallery-dots">
                {images.map((image, index) => (
                  <button
                    key={`${image.url}-dot-${index}`}
                    className={index === selectedImageIndex ? 'is-active' : ''}
                    aria-label={`Image ${index + 1}`}
                    aria-current={
                      index === selectedImageIndex ? 'true' : undefined
                    }
                    onClick={() => selectImage(index)}
                  />
                ))}
              </div>
              <button
                aria-label="Next image"
                onClick={() =>
                  selectImage((selectedImageIndex + 1) % images.length)
                }
              >
                <ArrowRight />
              </button>
            </div>
          ) : null}
        </section>

        <section className="product-purchase" aria-labelledby="product-title">
          <Link
            className="product-category-link"
            href={`/category/${product.category.slug}`}
          >
            {product.category.name}
          </Link>
          <h1 id="product-title">{product.title}</h1>
          {(product.ratingCount ?? 0) > 0 ? (
            <a className="product-rating-link" href="#reviews">
              <StarRating
                rating={product.ratingAverage}
                count={product.ratingCount}
              />{' '}
              Read reviews
            </a>
          ) : null}
          <div
            className="product-live-price"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="product-live-price__amount">
              {quote.isFetching ? (
                <LoaderCircle className="spin" aria-label="Updating price" />
              ) : (
                priceLabel
              )}
            </span>
            {product.compareAtPriceMinor &&
            quotePrice != null &&
            product.compareAtPriceMinor > quotePrice ? (
              <s>
                {formatMoney(product.compareAtPriceMinor, product.currency)}
              </s>
            ) : null}
            <span className="muted">Price for the options selected</span>
          </div>
          {quote.data?.availability ? (
            <AvailabilityBadge availability={quote.data.availability} />
          ) : (
            <AvailabilityBadge availability={product.availability} />
          )}
          {product.madeToOrder && product.leadTimeDays !== undefined ? (
            <p className="product-lead-time">
              Made to order, usually ready in {product.leadTimeDays} days
            </p>
          ) : null}
          {product.ecoNote ? (
            <p className="product-eco-note">
              <Leaf aria-hidden="true" />
              {product.ecoNote}
            </p>
          ) : null}

          <div className="product-option-groups">
            {product.optionGroups.map((group) => (
              <fieldset className="product-option-group" key={group.key}>
                <legend>
                  {group.label}
                  {group.required ? (
                    <span className="required-label">Required</span>
                  ) : null}
                  {group.key.toLowerCase().includes('color') ||
                  group.key.toLowerCase().includes('colour') ? (
                    <span className="selected-option-name">
                      {group.values.find(
                        (item) => item.value === selected[group.key],
                      )?.label ?? 'Choose a colour'}
                    </span>
                  ) : null}
                </legend>
                {group.key === 'color' || group.key === 'colour' ? (
                  <div className="option-color-values">
                    {group.values.map((value) => (
                      <div className="option-color-choice" key={value.value}>
                        <button
                          type="button"
                          className={`option-color${selected[group.key] === value.value ? ' is-selected' : ''}`}
                          aria-label={`${value.label}${value.priceModifierMinor ? `, ${formatMoney(value.priceModifierMinor, product.currency)} price difference` : ''}`}
                          aria-pressed={selected[group.key] === value.value}
                          onClick={() =>
                            setSelected((current) => ({
                              ...current,
                              [group.key]: value.value,
                            }))
                          }
                        >
                          <span
                            className="option-color__swatch"
                            style={{ backgroundColor: value.hex ?? '#E2E8F0' }}
                          />
                        </button>
                        {value.priceModifierMinor !== 0 ? (
                          <small>
                            {value.priceModifierMinor > 0 ? '+' : ''}
                            {formatMoney(
                              value.priceModifierMinor,
                              product.currency,
                            )}
                          </small>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : !/size|capacity/i.test(`${group.key} ${group.label}`) &&
                  group.values.length > 5 ? (
                  <select
                    aria-label={group.label}
                    value={selected[group.key] ?? ''}
                    required={group.required}
                    onChange={(event) =>
                      setSelected((current) => ({
                        ...current,
                        [group.key]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose {group.label.toLowerCase()}</option>
                    {group.values.map((value) => (
                      <option key={value.value} value={value.value}>
                        {value.label}
                        {value.priceModifierMinor
                          ? ` (${value.priceModifierMinor > 0 ? '+' : ''}${formatMoney(value.priceModifierMinor, product.currency)})`
                          : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="option-pill-values">
                    {group.values.map((value) => (
                      <button
                        key={value.value}
                        type="button"
                        className={
                          selected[group.key] === value.value
                            ? 'is-selected'
                            : ''
                        }
                        aria-pressed={selected[group.key] === value.value}
                        onClick={() =>
                          setSelected((current) => ({
                            ...current,
                            [group.key]: value.value,
                          }))
                        }
                      >
                        {value.label}
                        {value.priceModifierMinor !== 0 ? (
                          <small>
                            {value.priceModifierMinor > 0 ? '+' : ''}
                            {formatMoney(
                              value.priceModifierMinor,
                              product.currency,
                            )}
                          </small>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </fieldset>
            ))}
          </div>
          {product.quantityPricing.length ? (
            <p className="tier-pricing-hint">
              {product.quantityPricing
                .map(
                  (tier) =>
                    `Buy ${tier.minQty} or more: ${formatMoney(tier.unitPriceMinor, product.currency)} each`,
                )
                .join(' · ')}
            </p>
          ) : null}
          <div className="product-quantity-row">
            <span>Quantity</span>
            <QuantityStepper
              value={quantity}
              onChange={setQuantity}
              min={product.minOrderQuantity}
              max={product.maxOrderQuantity}
            />
          </div>

          {needsArtwork ? (
            <ArtworkUpload
              product={product}
              artwork={artwork}
              progress={uploadProgress}
              error={uploadError}
              onSelect={onArtworkFile}
              onRemove={() => void removeUploadedArtwork()}
              maxBytes={settings.data?.artwork.maxBytes}
              mimeTypes={settings.data?.artwork.allowedMimeTypes ?? []}
            />
          ) : null}

          {quote.data?.issues.length ? (
            <div className="catalog-inline-error" role="alert">
              {quote.data.issues.map((issue) => (
                <p key={`${issue.code}-${issue.message}`}>{issue.message}</p>
              ))}
            </div>
          ) : null}
          {quote.isError ? (
            <p className="catalog-inline-error" role="alert">
              The price could not be checked. Please try again.
            </p>
          ) : null}
          {product.artworkRequired && !artwork ? (
            <p className="product-action-hint">
              Upload artwork before adding this product to your cart.
            </p>
          ) : null}
          {cartError ? (
            <p className="catalog-inline-error" role="alert">
              {cartError}
            </p>
          ) : null}
          <div className="product-actions">
            <Button
              className="product-add-button"
              loading={adding}
              disabled={!canAdd}
              onClick={() => void addToCart()}
            >
              <ShoppingBag size={18} /> Add to cart
            </Button>
            <Button
              variant="secondary"
              disabled={!canAdd || adding}
              onClick={() => void addToCart(true)}
            >
              Buy now
            </Button>
            <WishlistToggle product={wishlistCard} />
          </div>
          {product.artworkRequired ? (
            <p className="product-trust-note">
              <Check aria-hidden="true" /> Artwork is checked before printing
            </p>
          ) : null}
        </section>
      </div>

      <section
        id="description"
        className="product-info-section product-description-section"
      >
        <h2>Description</h2>
        <p className="product-description">{product.description}</p>
      </section>

      <div className="product-information">
        <nav className="product-tabs" aria-label="Product information sections">
          <a href="#description">Description</a>
          {product.specifications.length ? (
            <a href="#specifications">Specifications</a>
          ) : null}
          {product.artworkRequired ||
          product.artworkRequirements.notes ||
          product.artworkRequirements.allowedFormats.length ? (
            <a href="#artwork-requirements">Artwork requirements</a>
          ) : null}
          {product.quantityPricing.length ? (
            <a href="#bulk-pricing">Bulk pricing</a>
          ) : null}
          <a href="#shipping">Shipping information</a>
          <a href="#reviews">Reviews</a>
        </nav>
        {product.specifications.length ? (
          <section id="specifications" className="product-info-section">
            <h2>Specifications</h2>
            <dl className="specification-table">
              {product.specifications.map((item) => (
                <div key={`${item.label}-${item.value}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        {product.artworkRequired ||
        product.artworkRequirements.notes ||
        product.artworkRequirements.allowedFormats.length ? (
          <section id="artwork-requirements" className="product-info-section">
            <h2>Artwork requirements</h2>
            {product.artworkRequirements.allowedFormats.length ? (
              <p>
                Accepted formats:{' '}
                {product.artworkRequirements.allowedFormats.join(', ')}
              </p>
            ) : null}
            {product.artworkRequirements.minimumResolutionNote ? (
              <p>{product.artworkRequirements.minimumResolutionNote}</p>
            ) : null}
            {product.artworkRequirements.notes ? (
              <p>{product.artworkRequirements.notes}</p>
            ) : null}
          </section>
        ) : null}
        {product.quantityPricing.length ? (
          <section id="bulk-pricing" className="product-info-section">
            <h2>Bulk pricing</h2>
            <table className="bulk-pricing-table">
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">Unit price</th>
                </tr>
              </thead>
              <tbody>
                {product.quantityPricing.map((tier) => (
                  <tr key={tier.minQty}>
                    <td>{tier.minQty} or more</td>
                    <td>
                      {formatMoney(tier.unitPriceMinor, product.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        <ShippingInformation settings={settings.data} />
        <div className="product-mobile-accordions">
          {product.specifications.length ? (
            <Accordion title="Specifications">
              <dl className="specification-table">
                {product.specifications.map((item) => (
                  <div key={`${item.label}-${item.value}`}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            </Accordion>
          ) : null}
          {product.artworkRequired ||
          product.artworkRequirements.notes ||
          product.artworkRequirements.allowedFormats.length ? (
            <Accordion title="Artwork requirements">
              <p>{product.artworkRequirements.allowedFormats.join(', ')}</p>
              <p>{product.artworkRequirements.minimumResolutionNote}</p>
              <p>{product.artworkRequirements.notes}</p>
            </Accordion>
          ) : null}
          {product.quantityPricing.length ? (
            <Accordion title="Bulk pricing">
              {product.quantityPricing.map((tier) => (
                <p key={tier.minQty}>
                  {tier.minQty} or more:{' '}
                  {formatMoney(tier.unitPriceMinor, product.currency)}
                </p>
              ))}
            </Accordion>
          ) : null}
          <Accordion title="Shipping information">
            <ShippingInformation settings={settings.data} />
          </Accordion>
        </div>
      </div>

      <section
        id="reviews"
        className="product-info-section product-reviews-section"
      >
        {showReviews ? (
          <ReviewsPanel slug={product.slug} />
        ) : (
          <>
            <h2>Customer reviews</h2>
            <p>Reviews are not loaded for this sample product.</p>
          </>
        )}
      </section>

      {product.relatedProducts.length ? (
        <section className="product-related" aria-labelledby="related-title">
          <div className="section-heading">
            <h2 id="related-title">You may also like</h2>
            <Link
              className="text-link"
              href={`/category/${product.category.slug}`}
            >
              View category <ArrowRight size={16} />
            </Link>
          </div>
          <ProductGrid products={product.relatedProducts.slice(0, 4)} />
        </section>
      ) : null}

      {showStickyBar && !mainButtonVisible ? (
        <div className="product-sticky-bar">
          <span aria-live="polite">{priceLabel}</span>
          <Button
            disabled={!canAdd || adding}
            loading={adding}
            onClick={() => void addToCart()}
          >
            <ShoppingBag size={17} /> Add to cart
          </Button>
        </div>
      ) : null}

      <Modal
        open={lightboxOpen && selectedImageIndex !== null}
        onClose={() => setLightboxOpen(false)}
        title={
          selectedImageIndex === null
            ? 'Product image unavailable'
            : `Product image ${selectedImageIndex + 1} of ${images.length}`
        }
      >
        {mainImage ? (
          <div className="product-lightbox">
            <Image
              src={mainImage.variants?.large ?? mainImage.url}
              alt={getProductImageAlt(product.title, mainImage.alt)}
              fill
              sizes="90vw"
            />
            <button
              className="product-lightbox__close"
              onClick={() => setLightboxOpen(false)}
              aria-label="Close image"
            >
              <X />
            </button>
            {images.length > 1 && selectedImageIndex !== null ? (
              <>
                <button
                  className="product-lightbox__prev"
                  onClick={() =>
                    setActiveImage(
                      (selectedImageIndex - 1 + images.length) % images.length,
                    )
                  }
                  aria-label="Previous image"
                >
                  <ArrowLeft />
                </button>
                <button
                  className="product-lightbox__next"
                  onClick={() =>
                    setActiveImage((selectedImageIndex + 1) % images.length)
                  }
                  aria-label="Next image"
                >
                  <ArrowRight />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export function ArtworkUpload({
  product,
  artwork,
  progress,
  error,
  onSelect,
  onRemove,
  maxBytes,
  mimeTypes,
}: {
  product: Pick<PublicProduct, 'artworkRequired'> & {
    artworkRequirements: Pick<
      PublicProduct['artworkRequirements'],
      'allowedFormats' | 'notes' | 'minimumResolutionNote'
    >;
  };
  artwork: Artwork | null;
  progress: number | null;
  error: string;
  onSelect: (file: File | undefined) => void;
  onRemove: () => void;
  maxBytes?: number;
  mimeTypes: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const accept = mimeTypes.join(',');
  return (
    <section className="artwork-upload" aria-labelledby="artwork-upload-title">
      <div>
        <h2 id="artwork-upload-title">
          Your artwork{' '}
          {product.artworkRequired ? (
            <span className="required-label">Required</span>
          ) : (
            <span className="muted">Optional</span>
          )}
        </h2>
        {product.artworkRequirements.notes ? (
          <p>{product.artworkRequirements.notes}</p>
        ) : null}
        {product.artworkRequirements.minimumResolutionNote ? (
          <p>{product.artworkRequirements.minimumResolutionNote}</p>
        ) : null}
        <p className="muted">
          Accepted:{' '}
          {mimeTypes.length
            ? mimeTypes
                .map((type) =>
                  type
                    .replace('image/', '')
                    .replace('application/', '')
                    .toUpperCase(),
                )
                .join(', ')
            : 'The accepted formats are provided by the shop settings'}
          {maxBytes ? ` up to ${formatBytes(maxBytes)}` : ''}
        </p>
      </div>
      {artwork ? (
        <div className="artwork-file-card">
          {artwork.preview ? (
            <Image
              src={artwork.preview}
              alt={`Preview of ${artwork.name}`}
              width={64}
              height={64}
              unoptimized
            />
          ) : (
            <FileImage aria-hidden="true" />
          )}
          <div>
            <strong>{artwork.name}</strong>
            <span>{formatBytes(artwork.sizeBytes)}</span>
          </div>
          <button type="button" onClick={() => fileRef.current?.click()}>
            Replace
          </button>
          <button type="button" onClick={onRemove}>
            Remove
          </button>
        </div>
      ) : (
        <button
          className={`artwork-dropzone${dragging ? ' is-dragging' : ''}`}
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void onSelect(event.dataTransfer.files[0]);
          }}
        >
          <Upload aria-hidden="true" />
          <span>
            Drop your artwork here or <strong>choose a file</strong>
          </span>
        </button>
      )}
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept={accept}
        onChange={(event) => {
          void onSelect(event.target.files?.[0]);
          event.target.value = '';
        }}
        aria-label="Choose artwork file"
      />
      {progress !== null ? (
        <div className="upload-progress">
          <progress value={progress} max={100}>
            {progress}%
          </progress>
          <span>{progress}%</span>
        </div>
      ) : null}
      {error ? (
        <p className="catalog-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {artwork ? (
        <p className="upload-success" role="status">
          <Check aria-hidden="true" /> Artwork uploaded.
        </p>
      ) : null}
    </section>
  );
}

function ShippingInformation({
  settings,
}: {
  settings: ReturnType<typeof useSettings>['data'];
}) {
  const address = settings?.studioAddress;
  const addressText = address
    ? [address.label, address.city, address.country].filter(Boolean).join(', ')
    : '';
  return (
    <section className="product-info-section" id="shipping">
      <h2>Shipping information</h2>
      <p>
        {settings?.turnaroundMessage ||
          'Delivery time and cost are confirmed at checkout.'}
      </p>
      {settings?.contactEmail ? (
        <p>
          Contact:{' '}
          <a href={`mailto:${settings.contactEmail}`}>
            {settings.contactEmail}
          </a>
        </p>
      ) : null}
      {settings?.contactPhone ? <p>{settings.contactPhone}</p> : null}
      {addressText ? <p>{addressText}</p> : null}
      {settings?.openingHoursDisplayText ? (
        <p>{settings.openingHoursDisplayText}</p>
      ) : null}
    </section>
  );
}

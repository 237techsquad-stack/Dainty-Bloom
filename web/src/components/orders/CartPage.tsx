'use client';

import Image from 'next/image';
import Link from 'next/link';
import { AlertCircle, ArrowRight, RefreshCw, ShoppingBag, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ArtworkUpload, type Artwork } from '@/components/catalog/ProductDetailClient';
import { Button, ConfirmDialog, QuantityStepper } from '@/components/ui';
import { useSettings } from '@/hooks/useSettings';
import { api, ApiError, uploadArtwork } from '@/lib/api/client';
import type { CartView } from '@/lib/api/types';
import { formatMoney } from '@/lib/utils/formatMoney';

const cartKey = ['cart'];
const summaryKey = ['cart-summary'];

export function CartPage() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const cart = useQuery({
    queryKey: cartKey,
    queryFn: api.cart,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const preview = useQuery({
    queryKey: ['checkout-preview'],
    queryFn: api.checkoutPreview,
    enabled: Boolean(settings.data?.shippingConfigured && cart.data?.items.length),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const [clearOpen, setClearOpen] = useState(false);
  const clear = useMutation({
    mutationFn: api.clearCart,
    onSuccess: (updated) => queryClient.setQueryData(cartKey, updated),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: summaryKey });
      void queryClient.invalidateQueries({ queryKey: ['checkout-preview'] });
      setClearOpen(false);
    },
  });
  const blockingLines = cart.data?.items.filter((item) =>
    item.issues.some((issue) => issue.blocking),
  ) ?? [];
  const checkoutBlocked = Boolean(cart.data?.hasBlockingIssues);

  if (cart.isPending) {
    return (
      <div
        className="commerce-page"
        role="status"
        aria-label="Loading your cart"
      >
        <div className="commerce-skeleton" aria-hidden="true">
          <div className="commerce-skeleton__block" />
          <div className="commerce-skeleton__block" />
        </div>
      </div>
    );
  }

  if (cart.isError || !cart.data) {
    return (
      <div className="commerce-page commerce-state" role="alert">
        <AlertCircle aria-hidden="true" />
        <h1>Your cart could not be loaded</h1>
        <p>{cart.error instanceof ApiError ? cart.error.message : 'Please try again.'}</p>
        <Button variant="secondary" onClick={() => void cart.refetch()}>
          <RefreshCw size={17} aria-hidden="true" /> Retry
        </Button>
      </div>
    );
  }

  if (cart.data.items.length === 0) {
    return (
      <div className="commerce-page">
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          <Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">Cart</span>
        </nav>
        <section className="commerce-card commerce-empty">
          <ShoppingBag size={38} aria-hidden="true" />
          <h1>Your cart is empty</h1>
          <p>Find something lovely to make your own.</p>
          <Link className="button button--primary button--md" href="/shop">Browse the shop</Link>
        </section>
      </div>
    );
  }

  const summary = (
    <CartSummary
      cart={cart.data}
      blocked={checkoutBlocked}
      stripeConfigured={Boolean(settings.data?.stripePublishableKey)}
      shippingConfigured={Boolean(settings.data?.shippingConfigured)}
      shippingMinor={preview.data?.shippingMinor}
      taxMinor={preview.data?.taxMinor}
      totalMinor={preview.data?.totalMinor}
      shippingLoading={Boolean(settings.data?.shippingConfigured && preview.isPending)}
      onClear={() => setClearOpen(true)}
      clearLoading={clear.isPending}
    />
  );

  return (
    <div className="commerce-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">Cart</span>
      </nav>
      <div className="commerce-page__heading">
        <div>
          <h1>Your cart</h1>
          <p>{cart.data.totals.itemCount} {cart.data.totals.itemCount === 1 ? 'item' : 'items'}</p>
        </div>
        <Link className="text-link" href="/shop">Continue shopping <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
      {blockingLines.length ? (
        <div className="commerce-alert" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <p>{blockingLines.length} {blockingLines.length === 1 ? 'item needs' : 'items need'} attention before you can check out.</p>
        </div>
      ) : null}
      {settings.data?.shippingConfigured && preview.isError ? (
        <div className="commerce-alert commerce-alert--error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <p>Shipping could not be calculated right now.</p>
          <Button size="sm" variant="secondary" onClick={() => void preview.refetch()}>Retry shipping</Button>
        </div>
      ) : null}
      <div className="cart-layout">
        <section className="cart-items" aria-label="Cart items">
          {cart.data.items.map((item) => (
            <CartLine key={item.itemId} item={item} currency={cart.data!.totals.currency} />
          ))}
        </section>
        {summary}
      </div>
      <div className="cart-mobile-bar">
        <p><span className="muted">Total</span><br /><strong>{formatMoney(preview.data?.totalMinor ?? cart.data.totals.totalMinor, cart.data.totals.currency)}</strong></p>
        <Link
          className={`button button--primary button--md${checkoutBlocked ? ' is-disabled' : ''}`}
          href="/checkout"
          aria-disabled={checkoutBlocked}
          onClick={(event) => {
            if (checkoutBlocked) event.preventDefault();
          }}
        >
          Checkout
        </Link>
      </div>
      <ConfirmDialog
        open={clearOpen}
        title="Clear your cart?"
        onClose={() => setClearOpen(false)}
        onConfirm={() => clear.mutate()}
      >
        This will remove every item from your cart.
      </ConfirmDialog>
    </div>
  );
}

function CartLine({
  item,
  currency,
}: {
  item: CartView['items'][number];
  currency: string;
}) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [quantity, setQuantity] = useState(item.quantity);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [removeOpen, setRemoveOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof api.updateCartItem>[1]) =>
      api.updateCartItem(item.itemId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: cartKey });
      const previous = queryClient.getQueryData<CartView>(cartKey);
      if (previous) {
        queryClient.setQueryData<CartView>(cartKey, {
          ...previous,
          items: previous.items.map((line) => {
            if (line.itemId !== item.itemId) return line;
            const nextQuantity = input.quantity ?? line.quantity;
            return {
              ...line,
              quantity: nextQuantity,
              lineTotalMinor: line.unitPriceMinor * nextQuantity,
            };
          }),
          totals: {
            ...previous.totals,
            itemCount: previous.items.reduce(
              (count, line) =>
                count +
                (line.itemId === item.itemId
                  ? (input.quantity ?? line.quantity)
                  : line.quantity),
              0,
            ),
          },
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(cartKey, context.previous);
      setQuantity(item.quantity);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(cartKey, updated);
      setQuantity(updated.items.find((line) => line.itemId === item.itemId)?.quantity ?? item.quantity);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cartKey });
      void queryClient.invalidateQueries({ queryKey: summaryKey });
      void queryClient.invalidateQueries({ queryKey: ['checkout-preview'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.removeCartItem(item.itemId),
    onSuccess: (updated) => queryClient.setQueryData(cartKey, updated),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: cartKey });
      void queryClient.invalidateQueries({ queryKey: summaryKey });
      void queryClient.invalidateQueries({ queryKey: ['checkout-preview'] });
      setRemoveOpen(false);
    },
  });
  const mutateCartItem = mutation.mutate;

  useEffect(() => {
    if (quantity === item.quantity) return;
    const timer = window.setTimeout(() => mutateCartItem({ quantity }), 400);
    return () => window.clearTimeout(timer);
  }, [item.itemId, item.quantity, mutateCartItem, quantity]);

  async function selectArtwork(file?: File) {
    if (!file) return;
    setUploadError('');
    setProgress(0);
    const previousId = item.artwork?.id;
    try {
      const uploaded = await uploadArtwork(file, setProgress);
      await api.updateCartItem(item.itemId, { artworkId: uploaded.id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cartKey }),
        queryClient.invalidateQueries({ queryKey: summaryKey }),
      ]);
      if (previousId) await api.removeArtwork(previousId);
    } catch (error) {
      setUploadError(error instanceof ApiError ? error.message : 'The artwork could not be attached to this item.');
    } finally {
      setProgress(null);
    }
  }

  async function removeArtwork() {
    if (!item.artwork) return;
    setUploadError('');
    try {
      await api.updateCartItem(item.itemId, { artworkId: null });
      await api.removeArtwork(item.artwork.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cartKey }),
        queryClient.invalidateQueries({ queryKey: summaryKey }),
      ]);
    } catch (error) {
      setUploadError(error instanceof ApiError ? error.message : 'The artwork could not be removed.');
    }
  }

  return (
    <article className="commerce-card cart-line">
      <Link className="cart-line__image" href={item.slug ? `/product/${item.slug}` : '/shop'} aria-label={`View ${item.title}`}>
        {item.image ? <Image src={item.image} alt="" fill sizes="(max-width: 767px) 80px, 104px" /> : <ShoppingBag aria-hidden="true" />}
      </Link>
      <div className="cart-line__content">
        <div className="cart-line__top">
          <h2><Link href={item.slug ? `/product/${item.slug}` : '/shop'}>{item.title}</Link></h2>
          <strong>{formatMoney(item.lineTotalMinor, currency)}</strong>
        </div>
        {item.selectedOptions.length ? (
          <ul className="cart-options" aria-label="Selected options">
            {item.selectedOptions.map((option) => (
              <li key={option.key}>{option.label}: {option.valueLabel}</li>
            ))}
          </ul>
        ) : null}
        {item.artworkAccepted ? (
          <div className="cart-line__artwork">
            {item.artwork?.previewUrl ? (
              <Image src={item.artwork.previewUrl} alt="" width={44} height={55} unoptimized />
            ) : null}
            {item.artwork ? (
              <span>
                {item.artwork.originalFilename} · {artworkStatusLabel(item.artworkStatus)}
              </span>
            ) : item.artworkRequired ? (
              <span>Artwork is required before checkout.</span>
            ) : (
              <span>Artwork can be added before checkout.</span>
            )}
          </div>
        ) : null}
        {item.issues.map((issue) => (
          <div className={`commerce-alert${issue.code === 'ARTWORK_REQUIRED' ? '' : ' commerce-alert--error'}`} role={issue.blocking ? 'alert' : 'status'} key={`${issue.code}-${issue.message}`}>
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <p>{issue.message}</p>
              {issue.code === 'PRICE_CHANGED' ? (
                <p>Previous price: {formatMoney(issue.oldPriceMinor ?? 0, currency)} · Current price: {formatMoney(issue.newPriceMinor ?? item.unitPriceMinor, currency)}</p>
              ) : null}
            </div>
            {issue.code === 'PRICE_CHANGED' ? (
              <Button size="sm" variant="secondary" loading={mutation.isPending} onClick={() => mutation.mutate({ quantity: item.quantity })}>Update price</Button>
            ) : null}
            {issue.code === 'PRODUCT_UNAVAILABLE' ? (
              <Button size="sm" variant="secondary" onClick={() => setRemoveOpen(true)}>Remove item</Button>
            ) : null}
          </div>
        ))}
        {item.artworkAccepted ? (
          <ArtworkUpload
            product={{
              artworkRequired: item.artworkRequired,
              artworkRequirements: item.artworkRequirements,
            }}
            artwork={item.artwork ? {
              id: item.artwork.id,
              name: item.artwork.originalFilename,
              mime: item.artwork.detectedMimeType,
              sizeBytes: 0,
              ...(item.artwork.previewUrl ? { preview: item.artwork.previewUrl } : {}),
            } satisfies Artwork : null}
            progress={progress}
            error={uploadError}
            onSelect={(file) => void selectArtwork(file)}
            onRemove={() => void removeArtwork()}
            maxBytes={settings.data?.artwork.maxBytes}
            mimeTypes={item.artworkRequirements.allowedFormats.length
              ? item.artworkRequirements.allowedFormats
              : settings.data?.artwork.allowedMimeTypes ?? []}
          />
        ) : null}
        <div className="cart-line__prices">
          <div className="cart-line__actions">
            <QuantityStepper
              value={quantity}
              onChange={setQuantity}
              min={1}
              max={99}
              label={`Quantity for ${item.title}`}
            />
            {mutation.isPending ? <span className="muted" role="status">Updating…</span> : null}
            <Link className="commerce-text-button" href={item.slug ? `/product/${item.slug}` : '/shop'}>Edit options</Link>
            <button type="button" className="commerce-text-button" onClick={() => setRemoveOpen(true)}>
              <Trash2 size={15} aria-hidden="true" /> Remove
            </button>
          </div>
          <span className="muted">{formatMoney(item.unitPriceMinor, currency)} each</span>
        </div>
        {mutation.isError ? (
          <p className="field-error" role="alert">
            {mutation.error instanceof ApiError ? mutation.error.message : 'The cart could not be updated. Please retry.'}
          </p>
        ) : null}
        {item.availability === 'low_stock' ? <p className="field-hint">Low stock — please check your quantity.</p> : null}
      </div>
      <ConfirmDialog
        open={removeOpen}
        title="Remove this item?"
        onClose={() => setRemoveOpen(false)}
        onConfirm={() => remove.mutate()}
      >
        {`Remove ${item.title} from your cart?`}
      </ConfirmDialog>
    </article>
  );
}

function CartSummary({
  cart,
  blocked,
  stripeConfigured,
  shippingConfigured,
  shippingMinor,
  taxMinor,
  totalMinor,
  shippingLoading,
  onClear,
  clearLoading,
}: {
  cart: CartView;
  blocked: boolean;
  stripeConfigured: boolean;
  shippingConfigured: boolean;
  shippingMinor?: number;
  taxMinor?: number;
  totalMinor?: number;
  shippingLoading: boolean;
  onClear: () => void;
  clearLoading: boolean;
}) {
  return (
    <aside className="commerce-card commerce-summary" aria-label="Cart summary">
      <h2>Order summary</h2>
      <div className="commerce-row"><span>Subtotal</span><span>{formatMoney(cart.totals.subtotalMinor, cart.totals.currency)}</span></div>
      {cart.totals.discountMinor > 0 ? <div className="commerce-row"><span>Discount</span><span>−{formatMoney(cart.totals.discountMinor, cart.totals.currency)}</span></div> : null}
      <div className="commerce-row">
        <span>Shipping</span>
        <span>{shippingLoading ? 'Calculating…' : shippingConfigured && shippingMinor !== undefined ? formatMoney(shippingMinor, cart.totals.currency) : 'Calculated at checkout'}</span>
      </div>
      {shippingConfigured && taxMinor ? <div className="commerce-row"><span>Tax</span><span>{formatMoney(taxMinor, cart.totals.currency)}</span></div> : null}
      <div className="commerce-row commerce-summary__total"><span>Total</span><span>{shippingLoading ? 'Calculating…' : formatMoney(totalMinor ?? cart.totals.totalMinor, cart.totals.currency)}</span></div>
      {blocked ? <p className="commerce-summary__note">Resolve the flagged items to continue to checkout.</p> : null}
      <div className="commerce-summary__actions">
        <Link
          className={`button button--primary button--md${blocked ? ' is-disabled' : ''}`}
          href="/checkout"
          aria-disabled={blocked}
          onClick={(event) => {
            if (blocked) event.preventDefault();
          }}
        >
          Checkout
        </Link>
        <Link className="button button--secondary button--md" href="/shop">Continue shopping</Link>
        <button className="commerce-text-button" type="button" onClick={onClear} disabled={clearLoading}>
          {clearLoading ? 'Clearing…' : 'Clear cart'}
        </button>
      </div>
      {stripeConfigured ? <p className="commerce-summary__note">Secure payments powered by Stripe.</p> : null}
    </aside>
  );
}

function artworkStatusLabel(status: string) {
  const labels: Record<string, string> = {
    uploaded: 'Uploaded',
    pending_review: 'Awaiting review',
    approved: 'Approved',
    replacement_requested: 'Replacement requested',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}

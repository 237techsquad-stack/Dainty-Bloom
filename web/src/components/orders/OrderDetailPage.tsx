'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, FileImage, Package, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArtworkUpload } from '@/components/catalog/ProductDetailClient';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button, ConfirmDialog, Input } from '@/components/ui';
import { useSettings } from '@/hooks/useSettings';
import { api, ApiError, uploadArtwork } from '@/lib/api/client';
import type { CustomerOrder } from '@/lib/api/types';
import { formatDate } from '@/lib/utils/formatDate';
import { formatMoney } from '@/lib/utils/formatMoney';
import { OrderStatusBadge } from './OrderStatusBadge';
import { orderStatusLabel, paymentStatusLabel } from './orderStatus';

export function OrderDetailPage({
  orderNumber,
  placed = false,
}: {
  orderNumber: string;
  placed?: boolean;
}) {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [guestEmail, setGuestEmail] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const order = useQuery({
    queryKey: ['customer-order', orderNumber, user?.id ?? guestEmail],
    queryFn: () =>
      user
        ? api.customerOrder(orderNumber)
        : api.lookupOrder(orderNumber, guestEmail),
    enabled: Boolean(orderNumber && (user || guestEmail)),
    retry: false,
  });

  useEffect(() => {
    if (!user) {
      const savedEmail = sessionStorage.getItem(
        'daintyBloom:guest-order-email',
      );
      if (savedEmail) {
        window.setTimeout(() => {
          setGuestEmail(savedEmail);
          setLookupEmail(savedEmail);
        }, 0);
      }
    }
  }, [user]);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLookupLoading(true);
    setLookupError('');
    const email = lookupEmail.trim();
    try {
      const result = await api.lookupOrder(orderNumber, email);
      sessionStorage.setItem('daintyBloom:guest-order-email', email);
      setGuestEmail(email);
      queryClient.setQueryData(['customer-order', orderNumber, email], result);
    } catch (error) {
      setLookupError(
        error instanceof ApiError
          ? error.message
          : 'The order could not be found with those details.',
      );
    } finally {
      setLookupLoading(false);
    }
  }

  if (!orderNumber) {
    return (
      <div className="commerce-page commerce-state" role="alert">
        <h1>Enter an order number</h1>
        <p>Use the tracking form to look up your order.</p>
        <Button onClick={() => router.push('/track-order')}>
          Track an order
        </Button>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="commerce-page">
        <div
          className="commerce-skeleton"
          role="status"
          aria-label="Loading account"
        >
          <div className="commerce-skeleton__block" />
        </div>
      </div>
    );
  }

  if (!user && !guestEmail) {
    return (
      <div className="commerce-page">
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          <Link href="/">Home</Link>
          <span aria-hidden="true">/</span>
          <span>Order</span>
        </nav>
        <form
          className="commerce-card track-form"
          onSubmit={(event) => void lookup(event)}
        >
          <h1>View your order</h1>
          <p>Enter the email address used for this order.</p>
          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            value={lookupEmail}
            onChange={(event) => setLookupEmail(event.target.value)}
            required
          />
          {lookupError ? (
            <p className="field-error" role="alert">
              {lookupError}
            </p>
          ) : null}
          <Button type="submit" loading={lookupLoading}>
            Find order
          </Button>
        </form>
      </div>
    );
  }

  if (order.isPending) {
    return (
      <div className="commerce-page">
        <div
          className="commerce-skeleton"
          role="status"
          aria-label="Loading order"
        >
          <div className="commerce-skeleton__block" />
          <div className="commerce-skeleton__block" />
        </div>
      </div>
    );
  }
  if (order.isError || !order.data) {
    return (
      <div className="commerce-page commerce-state" role="alert">
        <AlertCircle aria-hidden="true" />
        <h1>Order details are unavailable</h1>
        <p>
          {order.error instanceof ApiError
            ? order.error.message
            : 'Please check your order details and try again.'}
        </p>
        <Button variant="secondary" onClick={() => void order.refetch()}>
          <RefreshCw size={16} /> Retry
        </Button>
        {!user ? (
          <Link className="text-link" href="/track-order">
            Use order lookup
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="commerce-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Order {order.data.orderNumber}</span>
      </nav>
      {placed ? (
        <div className="commerce-alert" role="status">
          <Package size={19} aria-hidden="true" />
          <p>
            Your order has been placed. Keep your order number,{' '}
            <strong>{order.data.orderNumber}</strong>, so you can track this
            order at any time.
          </p>
        </div>
      ) : null}
      <OrderDetailView
        order={order.data}
        email={user ? undefined : guestEmail}
        onOrderChange={(updated) =>
          queryClient.setQueryData(
            ['customer-order', orderNumber, user?.id ?? guestEmail],
            updated,
          )
        }
      />
    </div>
  );
}

function OrderDetailView({
  order,
  email,
  onOrderChange,
}: {
  order: CustomerOrder;
  email?: string;
  onOrderChange: (order: CustomerOrder) => void;
}) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const settings = useSettings();
  const canCancel = [
    'pending_payment',
    'pending_proof_approval',
    'artwork_rejected',
  ].includes(order.status);
  const displayShipment = Boolean(
    order.shipment && ['shipped', 'completed'].includes(order.status),
  );

  async function payNow() {
    setBusy(true);
    setError('');
    try {
      const session = await api.startOrderPayment(order.orderNumber, email);
      window.location.assign(session.checkoutUrl);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : 'Payment could not be started.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder() {
    setBusy(true);
    setError('');
    try {
      onOrderChange(await api.cancelCustomerOrder(order.orderNumber, email));
      setCancelOpen(false);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : 'The order could not be cancelled.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function replaceArtwork(itemId: string, file?: File) {
    if (!file) return;
    setUploadingItemId(itemId);
    setUploadProgress(0);
    setError('');
    try {
      const uploaded = await uploadArtwork(file, setUploadProgress);
      onOrderChange(
        await api.replaceCustomerOrderArtwork(
          order.orderNumber,
          itemId,
          uploaded.id,
          email,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : 'Replacement artwork could not be submitted.',
      );
    } finally {
      setUploadingItemId('');
      setUploadProgress(null);
    }
  }

  return (
    <div className="order-detail">
      <header className="commerce-page__heading order-detail__heading">
        <div>
          <h1>Order {order.orderNumber}</h1>
          <p>Placed {formatDate(order.createdAt)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </header>
      {error ? (
        <div className="commerce-alert commerce-alert--error" role="alert">
          <AlertCircle size={18} />
          <p>{error}</p>
        </div>
      ) : null}
      <section className="commerce-card">
        <h2>Order progress</h2>
        <ol className="order-timeline">
          {order.statusHistory.length ? (
            order.statusHistory.map((entry, index) => (
              <li
                className="is-complete"
                key={`${entry.to}-${entry.at}-${index}`}
              >
                <strong>{orderStatusLabel(entry.to)}</strong>
                <time dateTime={entry.at}>{formatDate(entry.at)}</time>
              </li>
            ))
          ) : (
            <li className="is-complete">
              <strong>{orderStatusLabel(order.status)}</strong>
              <time dateTime={order.createdAt}>
                {formatDate(order.createdAt)}
              </time>
            </li>
          )}
        </ol>
      </section>
      <section className="commerce-card">
        <h2>Items</h2>
        <div className="order-detail__items">
          {order.items.map((item) => (
            <article className="order-detail-item" key={item.id}>
              <div className="order-detail-item__image">
                {item.image ? (
                  <Image src={item.image} alt="" fill sizes="72px" />
                ) : (
                  <FileImage aria-hidden="true" />
                )}
              </div>
              <div>
                <h3>{item.title}</h3>
                <p>Quantity: {item.quantity}</p>
                {item.selectedOptions.length ? (
                  <ul className="cart-options">
                    {item.selectedOptions.map((option) => (
                      <li key={option.key}>
                        {option.label ?? option.key}:{' '}
                        {option.valueLabel ?? option.value}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.artwork ? (
                  <p className="field-hint">
                    Artwork: {item.artwork.originalFilename ?? 'File attached'}{' '}
                    · {artworkReviewLabel(item.artwork.reviewStatus)}
                  </p>
                ) : null}
              </div>
              <strong>
                {formatMoney(item.lineTotalMinor, order.totals.currency)}
              </strong>
              {order.status === 'artwork_rejected' &&
              item.artwork?.reviewStatus === 'replacement_requested' ? (
                <div className="commerce-alert commerce-alert--error order-item-alert">
                  <AlertCircle size={18} aria-hidden="true" />
                  <div>
                    <p>Replacement artwork requested for {item.title}.</p>
                    {item.artwork.reviewNote ? (
                      <p>{item.artwork.reviewNote}</p>
                    ) : null}
                    <ArtworkUpload
                      product={{
                        artworkRequired: true,
                        artworkRequirements: { allowedFormats: [] },
                      }}
                      artwork={null}
                      progress={
                        uploadingItemId === item.id ? uploadProgress : null
                      }
                      error=""
                      onSelect={(file) => void replaceArtwork(item.id, file)}
                      onRemove={() => undefined}
                      mimeTypes={settings.data?.artwork.allowedMimeTypes ?? []}
                    />
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      <section className="commerce-card order-detail__payment">
        <h2>Payment</h2>
        <div className="commerce-row">
          <span>{paymentStatusLabel(order.payment.status)}</span>
          {order.payment.status === 'pending' ? (
            <Button loading={busy} onClick={() => void payNow()}>
              Pay now
            </Button>
          ) : null}
        </div>
      </section>
      {displayShipment && order.shipment ? (
        <section className="commerce-card">
          <h2>Shipment</h2>
          <p>
            {order.shipment.carrier} · {order.shipment.trackingNumber}
          </p>
          {order.shipment.trackingUrl ? (
            <a
              href={order.shipment.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Track shipment
            </a>
          ) : null}
        </section>
      ) : null}
      <section className="commerce-card order-addresses">
        <div>
          <h2>Shipping address</h2>
          <AddressDisplay address={order.shippingAddress} />
        </div>
        <div>
          <h2>Billing address</h2>
          <AddressDisplay address={order.billingAddress} />
        </div>
      </section>
      <section className="commerce-card order-totals">
        <h2>Totals</h2>
        <div className="commerce-row">
          <span>Subtotal</span>
          <span>
            {formatMoney(order.totals.subtotalMinor, order.totals.currency)}
          </span>
        </div>
        {order.totals.discountMinor > 0 ? (
          <div className="commerce-row">
            <span>Discount</span>
            <span>
              −{formatMoney(order.totals.discountMinor, order.totals.currency)}
            </span>
          </div>
        ) : null}
        <div className="commerce-row">
          <span>Shipping</span>
          <span>
            {formatMoney(order.totals.shippingMinor, order.totals.currency)}
          </span>
        </div>
        {order.totals.taxMinor > 0 ? (
          <div className="commerce-row">
            <span>Tax</span>
            <span>
              {formatMoney(order.totals.taxMinor, order.totals.currency)}
            </span>
          </div>
        ) : null}
        <div className="commerce-row commerce-summary__total">
          <strong>Total</strong>
          <strong>
            {formatMoney(order.totals.totalMinor, order.totals.currency)}
          </strong>
        </div>
      </section>
      <div className="cart-line__actions">
        <Button variant="secondary" onClick={() => router.push('/shop')}>
          Continue shopping
        </Button>
        {canCancel ? (
          <Button variant="danger" onClick={() => setCancelOpen(true)}>
            Cancel order
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this order?"
        onClose={() => setCancelOpen(false)}
        onConfirm={() => void cancelOrder()}
      >
        Cancelling an order cannot be undone.
      </ConfirmDialog>
    </div>
  );
}

function AddressDisplay({
  address,
}: {
  address: CustomerOrder['shippingAddress'];
}) {
  return (
    <address>
      {address.line1}
      <br />
      {address.line2 ? (
        <>
          {address.line2}
          <br />
        </>
      ) : null}
      {address.city}, {address.state} {address.postalCode}
      <br />
      {address.country}
    </address>
  );
}

function artworkReviewLabel(status: string | null) {
  if (status === 'approved') return 'Approved';
  if (status === 'replacement_requested') return 'Replacement requested';
  if (status === 'pending') return 'Awaiting review';
  return status?.replaceAll('_', ' ') ?? 'Awaiting review';
}

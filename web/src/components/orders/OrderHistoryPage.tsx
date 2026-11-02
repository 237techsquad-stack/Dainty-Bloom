'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDate } from '@/lib/utils/formatDate';
import { formatMoney } from '@/lib/utils/formatMoney';
import { OrderStatusBadge } from './OrderStatusBadge';

const STATUSES = [
  ['pending_payment', 'Awaiting payment'],
  ['pending_proof_approval', 'Awaiting artwork approval'],
  ['artwork_rejected', 'Artwork needs changes'],
  ['in_printing', 'In production'],
  ['ready', 'Ready'],
  ['shipped', 'Shipped'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
] as const;

export function OrderHistoryPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const orders = useQuery({
    queryKey: ['customer-orders', page, status],
    queryFn: () =>
      api.customerOrders({
        page,
        limit: 10,
        ...(status ? { status } : {}),
      }),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  if (authLoading)
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
  if (!user) {
    return (
      <div className="commerce-page">
        <section className="commerce-card checkout-signin">
          <h1>Sign in to view your orders</h1>
          <p>Your order history is available with your customer account.</p>
          <Button
            onClick={() => router.push('/login?next=%2Faccount%2Forders')}
          >
            Sign in
          </Button>
        </section>
      </div>
    );
  }
  if (orders.isPending)
    return (
      <div className="commerce-page">
        <div
          className="commerce-skeleton"
          role="status"
          aria-label="Loading orders"
        >
          <div className="commerce-skeleton__block" />
          <div className="commerce-skeleton__block" />
        </div>
      </div>
    );
  if (orders.isError || !orders.data) {
    return (
      <div className="commerce-page commerce-state" role="alert">
        <h1>Your orders could not be loaded</h1>
        <p>Please retry in a moment.</p>
        <Button variant="secondary" onClick={() => void orders.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="commerce-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">My orders</span>
      </nav>
      <div className="commerce-page__heading">
        <div>
          <h1>My orders</h1>
          <p>Review your order history and track progress.</p>
        </div>
        <Link href="/account/custom-requests">My custom requests</Link>
        <label className="field">
          <span className="field-label">Filter by status</span>
          <select
            className="input"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All orders</option>
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {orders.data.items.length ? (
        <>
          <div className="order-list">
            {orders.data.items.map((order) => (
              <article
                className="commerce-card order-list-card"
                key={order.orderNumber}
              >
                <div className="order-list-card__main">
                  <Link
                    href={`/orders/${encodeURIComponent(order.orderNumber)}`}
                  >
                    <strong>{order.orderNumber}</strong>
                  </Link>
                  <span>{formatDate(order.createdAt)}</span>
                  <OrderStatusBadge status={order.status} />
                  <span>
                    {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <div>
                  <strong>
                    {formatMoney(order.totalMinor, order.currency)}
                  </strong>
                  <p>{order.paymentStatus.replaceAll('_', ' ')}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="pagination-controls">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </Button>
            <span>
              Page {orders.data.pagination.page} of{' '}
              {Math.max(orders.data.pagination.totalPages, 1)}
            </span>
            <Button
              variant="secondary"
              disabled={!orders.data.pagination.hasNextPage}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </>
      ) : (
        <section className="commerce-card commerce-empty">
          <h2>{status ? 'No orders match this status' : 'No orders yet'}</h2>
          <p>
            {status
              ? 'Choose another status or clear the filter.'
              : 'When you place an order, it will appear here.'}
          </p>
          {status ? (
            <Button variant="secondary" onClick={() => setStatus('')}>
              Clear filter
            </Button>
          ) : (
            <Button onClick={() => router.push('/shop')}>
              Browse the shop
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { Eye, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminStatusBadge, PageHeader } from '@/components/admin';
import { AdminIconButton } from '@/components/admin/AdminIconButton';
import { Button } from '@/components/ui';
import { ApiError, api } from '@/lib/api/client';
import type { AdminOrderDetail, AdminOrderStatus } from '@/lib/api/types';
import { formatMoney } from '@/lib/utils/formatMoney';

const ORDER_TABS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All orders' },
  { value: 'pending_payment', label: 'Pending payment' },
  { value: 'pending_proof_approval', label: 'Proof approval' },
  { value: 'artwork_rejected', label: 'Artwork rejected' },
  { value: 'in_printing', label: 'In printing' },
  { value: 'ready', label: 'Ready' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

function parseMoney(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return undefined;
  const [whole, fraction = ''] = trimmed.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : undefined;
}

function apiErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The request could not be completed.';
}

function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p className="admin-operation-error" role="alert">
      {apiErrorMessage(error)}
    </p>
  ) : null;
}

function Pagination({
  page,
  totalPages,
  hasNextPage,
  onPage,
}: {
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className="admin-operation-pagination">
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
      >
        Previous
      </Button>
      <span>
        Page {page} of {Math.max(1, totalPages)}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={!hasNextPage}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

export function AdminOrdersManagement({
  initialQuery = '',
}: {
  initialQuery?: string;
}) {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const router = useRouter();
  const orders = useQuery({
    queryKey: ['admin-orders', { tab, query, page }],
    queryFn: () => api.adminOrders({ tab, q: query, page, limit: 25 }),
    retry: false,
  });
  const items = orders.data?.items ?? [];
  const allVisibleSelected =
    items.length > 0 && items.every((item) => selectedIds.has(item.id));

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(search.trim());
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Orders"
        description="Review order status, customer details, production and fulfilment."
      />
      <form className="admin-filter-bar" onSubmit={submitSearch}>
        <label>
          Search orders
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Order number, customer or email"
          />
        </label>
        <label>
          Status
          <select
            className="input"
            value={tab}
            onChange={(event) => {
              setTab(event.currentTarget.value);
              setPage(1);
            }}
          >
            {ORDER_TABS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Search</Button>
      </form>

      <section className="admin-panel" aria-labelledby="orders-list-title">
        <div className="admin-panel-heading">
          <div>
            <h2 id="orders-list-title">Order list</h2>
            <p>
              {orders.data
                ? `${orders.data.pagination.total} orders`
                : 'Orders'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Refresh orders"
            onClick={() => void orders.refetch()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </Button>
        </div>
        <div className="admin-orders-table-wrap">
          <table className="admin-orders-table">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all orders on this page"
                    checked={allVisibleSelected}
                    disabled={!items.length || orders.isError}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        for (const item of items) {
                          if (checked) next.add(item.id);
                          else next.delete(item.id);
                        }
                        return next;
                      });
                    }}
                  />
                </th>
                <th scope="col">Order number</th>
                <th scope="col">Customer</th>
                <th scope="col">Date</th>
                <th scope="col">Items</th>
                <th scope="col">Total</th>
                <th scope="col">Payment status</th>
                <th scope="col">Fulfilment status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.isError ? (
                <tr className="admin-orders-state-row">
                  <td colSpan={9}>
                    <div className="admin-orders-error" role="alert">
                      <div>
                        <strong>Orders could not be loaded</strong>
                        <p>{apiErrorMessage(orders.error)}</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void orders.refetch()}
                      >
                        Try again
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : orders.isPending ? (
                <tr className="admin-orders-state-row">
                  <td colSpan={9} role="status">
                    Loading orders…
                  </td>
                </tr>
              ) : items.length ? (
                items.map((item) => (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    aria-label={`View order ${item.orderNumber}`}
                    onClick={() =>
                      router.push(
                        `/admin/orders/${encodeURIComponent(item.id)}`,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        router.push(
                          `/admin/orders/${encodeURIComponent(item.id)}`,
                        );
                      }
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select order ${item.orderNumber}`}
                        checked={selectedIds.has(item.id)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="admin-orders-table-number">
                      {item.orderNumber}
                    </td>
                    <td>
                      <span>
                        {item.contactSnapshot.name ||
                          'Customer details unavailable'}
                      </span>
                      {item.contactSnapshot.email ? (
                        <small className="admin-operation-subtext">
                          {item.contactSnapshot.email}
                        </small>
                      ) : null}
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>
                      {item.itemCount} {item.itemCount === 1 ? 'item' : 'items'}
                    </td>
                    <td>{formatMoney(item.totalMinor, item.currency)}</td>
                    <td>
                      <AdminStatusBadge status={item.payment.status} />
                    </td>
                    <td>
                      <AdminStatusBadge
                        status={item.fulfillmentStatus ?? 'unfulfilled'}
                      />
                    </td>
                    <td>
                      <AdminIconButton
                        label={`View details for order ${item.orderNumber}`}
                        onClick={() => {
                          router.push(
                            `/admin/orders/${encodeURIComponent(item.id)}`,
                          );
                        }}
                      >
                        <Eye size={16} aria-hidden="true" />
                      </AdminIconButton>
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="admin-orders-state-row">
                  <td colSpan={9}>
                    <div className="admin-orders-empty" role="status">
                      <strong>
                        {query || tab !== 'all'
                          ? 'No orders match these filters'
                          : 'No orders yet'}
                      </strong>
                      <p>
                        {query || tab !== 'all'
                          ? 'Try changing your search or status filter.'
                          : 'New customer orders will appear here.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {orders.data ? (
          <Pagination
            page={orders.data.pagination.page}
            totalPages={orders.data.pagination.totalPages}
            hasNextPage={orders.data.pagination.hasNextPage}
            onPage={setPage}
          />
        ) : null}
      </section>
    </>
  );
}

export function OrderActions({
  order,
  canUpdateStatus,
  statusPending,
  cancelPending,
  dispatchPending,
  notePending,
  refundPending,
  canRefund,
  error,
  onStatus,
  onCancel,
  onDispatch,
  onNote,
  onRefund,
}: {
  order: AdminOrderDetail;
  canUpdateStatus: boolean;
  statusPending: boolean;
  cancelPending: boolean;
  dispatchPending: boolean;
  notePending: boolean;
  refundPending: boolean;
  canRefund: boolean;
  error: unknown;
  onStatus: (status: AdminOrderStatus, note?: string) => void;
  onCancel: (input: { reason: string; restock: boolean }) => void;
  onDispatch: (input: {
    carrier: string;
    trackingNumber: string;
    trackingUrl?: string;
    note?: string;
  }) => void;
  onNote: (note: string) => void;
  onRefund: (input: {
    amountMinor: number;
    reason: string;
    reference?: string;
  }) => void;
}) {
  return (
    <section
      className="admin-operation-actions"
      aria-labelledby="order-actions-title"
    >
      <h3 id="order-actions-title">Order actions</h3>
      <ErrorNotice error={error} />
      {canUpdateStatus &&
      order.allowedNextStatuses.filter(
        (status) => status !== 'cancelled' && status !== 'shipped',
      ).length ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const requestedStatus = String(data.get('nextStatus') ?? '');
            const permittedStatus = order.allowedNextStatuses.find(
              (status) =>
                status === requestedStatus &&
                status !== 'cancelled' &&
                status !== 'shipped',
            );
            if (permittedStatus) {
              onStatus(
                permittedStatus,
                String(data.get('statusNote') ?? '').trim() || undefined,
              );
            }
          }}
        >
          <label>
            Next status
            <select className="input" name="nextStatus" defaultValue="">
              <option value="">Choose status</option>
              {order.allowedNextStatuses
                .filter(
                  (status) => status !== 'cancelled' && status !== 'shipped',
                )
                .map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll('_', ' ')}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Status note (optional)
            <input name="statusNote" className="input" maxLength={2000} />
          </label>
          <Button type="submit" disabled={statusPending}>
            {statusPending ? 'Updating…' : 'Update status'}
          </Button>
        </form>
      ) : null}
      {canUpdateStatus && order.status === 'ready' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const carrier = String(data.get('carrier') ?? '').trim();
            const trackingNumber = String(
              data.get('trackingNumber') ?? '',
            ).trim();
            if (carrier && trackingNumber) {
              onDispatch({
                carrier,
                trackingNumber,
                trackingUrl:
                  String(data.get('trackingUrl') ?? '').trim() || undefined,
                note:
                  String(data.get('dispatchNote') ?? '').trim() || undefined,
              });
            }
          }}
        >
          <h4>Record dispatch</h4>
          <label>
            Carrier
            <input className="input" name="carrier" required maxLength={100} />
          </label>
          <label>
            Tracking number
            <input
              className="input"
              name="trackingNumber"
              required
              maxLength={200}
            />
          </label>
          <label>
            Tracking URL (optional)
            <input className="input" name="trackingUrl" type="url" />
          </label>
          <label>
            Dispatch note (optional)
            <input className="input" name="dispatchNote" maxLength={2000} />
          </label>
          <Button type="submit" disabled={dispatchPending}>
            {dispatchPending ? 'Saving…' : 'Dispatch order'}
          </Button>
        </form>
      ) : null}
      {canUpdateStatus && order.allowedNextStatuses.includes('cancelled') ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const reason = String(data.get('cancelReason') ?? '').trim();
            if (reason && data.get('confirmCancel') === 'on') {
              onCancel({ reason, restock: data.get('restock') === 'on' });
            }
          }}
        >
          <h4>Cancel order</h4>
          <label>
            Reason
            <input
              className="input"
              name="cancelReason"
              required
              maxLength={2000}
            />
          </label>
          <label className="admin-operation-checkbox">
            <input type="checkbox" name="restock" defaultChecked /> Restore
            reserved stock
          </label>
          <label className="admin-operation-checkbox">
            <input type="checkbox" name="confirmCancel" required /> I understand
            this cancels fulfilment; any refund is a separate action.
          </label>
          <Button type="submit" variant="danger" disabled={cancelPending}>
            {cancelPending ? 'Cancelling…' : 'Cancel order'}
          </Button>
        </form>
      ) : null}
      {canRefund &&
      ['paid', 'partially_refunded', 'refund_due'].includes(
        order.payment.status,
      ) ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const amountMinor = parseMoney(
              String(data.get('refundAmount') ?? ''),
            );
            const reason = String(data.get('refundReason') ?? '').trim();
            const reference = String(data.get('refundReference') ?? '').trim();
            if (amountMinor && amountMinor > 0 && reason) {
              onRefund({
                amountMinor,
                reason,
                ...(reference ? { reference } : {}),
              });
            }
          }}
        >
          <h4>Record or request refund</h4>
          <p className="admin-operation-note">
            Refunds are limited to the remaining order balance. Confirm the
            configured payment provider&apos;s response before reporting
            completion.
          </p>
          <label>
            Amount ({order.totals.currency})
            <input
              className="input"
              name="refundAmount"
              required
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
          <label>
            Reason
            <input
              className="input"
              name="refundReason"
              required
              maxLength={1000}
            />
          </label>
          <label>
            Provider reference (optional)
            <input className="input" name="refundReference" maxLength={200} />
          </label>
          <label className="admin-operation-checkbox">
            <input type="checkbox" name="confirmRefund" required /> I have
            reviewed this refund request and its provider response.
          </label>
          <Button type="submit" variant="secondary" disabled={refundPending}>
            {refundPending ? 'Processing…' : 'Submit refund'}
          </Button>
        </form>
      ) : null}
      {canUpdateStatus ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const note = String(
              new FormData(form).get('internalNote') ?? '',
            ).trim();
            if (note) {
              onNote(note);
              form.reset();
            }
          }}
        >
          <h4>Internal note</h4>
          <label>
            Note
            <textarea
              className="input"
              name="internalNote"
              required
              maxLength={2000}
              rows={3}
            />
          </label>
          <Button type="submit" variant="secondary" disabled={notePending}>
            {notePending ? 'Saving…' : 'Add note'}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdminConfirmDialog,
  AdminStatusBadge,
  PageHeader,
} from '@/components/admin';
import { usePermissions } from '@/components/providers/AuthProvider';
import { Button, ErrorState } from '@/components/ui';
import { OrderActions } from '@/components/admin/AdminOrdersManagement';
import { ApiError, api } from '@/lib/api/client';
import type { AdminOrderStatus } from '@/lib/api/types';
import { formatMoney } from '@/lib/utils/formatMoney';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

function addressLines(address: Record<string, string>): string[] {
  return [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter(Boolean);
}

function apiErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The request could not be completed.';
}

export function AdminOrderDetailManagement({ orderId }: { orderId: string }) {
  const [confirmComplete, setConfirmComplete] = useState(false);
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['admin-order', orderId],
    queryFn: () => api.adminOrder(orderId),
    retry: false,
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-order', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['admin-print-queue'] }),
    ]);
  };
  const statusUpdate = useMutation({
    mutationFn: (input: { status: AdminOrderStatus; note?: string }) =>
      api.updateAdminOrderStatus(orderId, input),
    onSuccess: invalidate,
  });
  const cancelOrder = useMutation({
    mutationFn: (input: { reason: string; restock: boolean }) =>
      api.cancelAdminOrder(orderId, input),
    onSuccess: invalidate,
  });
  const dispatchOrder = useMutation({
    mutationFn: (input: {
      carrier: string;
      trackingNumber: string;
      trackingUrl?: string;
      note?: string;
    }) => api.dispatchAdminOrder(orderId, input),
    onSuccess: invalidate,
  });
  const completeOrder = useMutation({
    mutationFn: (note?: string) => api.completeAdminOrder(orderId, note),
    onSuccess: async () => {
      setConfirmComplete(false);
      await invalidate();
    },
  });
  const addNote = useMutation({
    mutationFn: (note: string) => api.addAdminOrderNote(orderId, note),
    onSuccess: invalidate,
  });
  const refund = useMutation({
    mutationFn: (input: {
      amountMinor: number;
      reason: string;
      reference?: string;
    }) => api.refundAdminOrder(orderId, input),
    onSuccess: invalidate,
  });
  const order = detail.data;

  return (
    <>
      <PageHeader
        title={order?.orderNumber ?? 'Order details'}
        description={
          order ? `Placed ${formatDate(order.createdAt)}` : undefined
        }
        actions={
          <Link
            className="button button--secondary button--md"
            href="/admin/orders"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to orders
          </Link>
        }
      />
      {detail.isPending ? (
        <section className="admin-panel" role="status">
          Loading order details…
        </section>
      ) : detail.isError ? (
        <section className="admin-panel">
          <ErrorState title="Order details could not be loaded">
            {apiErrorMessage(detail.error)}
          </ErrorState>
        </section>
      ) : order ? (
        <>
          <div className="admin-order-detail-grid">
            <section className="admin-panel admin-order-detail-card">
              <div className="admin-panel-heading">
                <h2>Order summary</h2>
                <AdminStatusBadge status={order.status} />
              </div>
              <dl className="admin-order-summary">
                <div>
                  <dt>Order number</dt>
                  <dd>{order.orderNumber}</dd>
                </div>
                <div>
                  <dt>Order date</dt>
                  <dd>{formatDate(order.createdAt)}</dd>
                </div>
                <div>
                  <dt>Order status</dt>
                  <dd>
                    <AdminStatusBadge status={order.status} />
                  </dd>
                </div>
                <div>
                  <dt>Fulfilment</dt>
                  <dd>
                    <AdminStatusBadge status={order.fulfillmentStatus} />
                  </dd>
                </div>
              </dl>
            </section>
            <section className="admin-panel admin-order-detail-card">
              <h2>Customer and payment</h2>
              <p>
                <strong>
                  {order.contact.name || 'Customer details unavailable'}
                </strong>
              </p>
              <p>
                <a href={`mailto:${order.contact.email}`}>
                  {order.contact.email}
                </a>
              </p>
              {order.contact.phone ? <p>{order.contact.phone}</p> : null}
              {order.guestEmail && order.guestEmail !== order.contact.email ? (
                <p>Guest email: {order.guestEmail}</p>
              ) : null}
              <p>
                Payment <AdminStatusBadge status={order.payment.status} />
              </p>
              <p>Provider: {order.payment.provider}</p>
              {order.payment.providerReference ? (
                <p>Payment reference: {order.payment.providerReference}</p>
              ) : null}
              {order.payment.paidAt ? (
                <p>Paid {formatDate(order.payment.paidAt)}</p>
              ) : null}
            </section>
            <section className="admin-panel admin-order-detail-card">
              <h2>Delivery and billing</h2>
              <div className="admin-order-addresses">
                <div>
                  <h3>Shipping address</h3>
                  <address>
                    {addressLines(order.shippingAddress).map((line, index) => (
                      <span key={`${index}-${line}`}>{line}</span>
                    ))}
                  </address>
                </div>
                <div>
                  <h3>Billing address</h3>
                  <address>
                    {addressLines(order.billingAddress).map((line, index) => (
                      <span key={`${index}-${line}`}>{line}</span>
                    ))}
                  </address>
                </div>
              </div>
              {order.customerNote ? (
                <p>
                  <strong>Customer note:</strong> {order.customerNote}
                </p>
              ) : null}
            </section>
            <section className="admin-panel admin-order-detail-card">
              <h2>Shipment</h2>
              {order.shipment ? (
                <>
                  <p>
                    {order.shipment.carrier} · {order.shipment.trackingNumber}
                  </p>
                  {order.shipment.trackingUrl ? (
                    <p>
                      <a
                        href={order.shipment.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Tracking link
                      </a>
                    </p>
                  ) : null}
                  <p>Dispatched {formatDate(order.shipment.dispatchedAt)}</p>
                  {order.shipment.note ? <p>{order.shipment.note}</p> : null}
                </>
              ) : (
                <p>No shipment recorded.</p>
              )}
            </section>
          </div>

          <section className="admin-panel admin-order-detail-section">
            <h2>Items</h2>
            <div className="admin-order-items">
              {order.items.map((item) => (
                <article className="admin-order-item" key={item.id}>
                  <div>
                    <h3>{item.title}</h3>
                    <p>
                      SKU {item.sku} · {item.quantity} ×{' '}
                      {formatMoney(item.unitPriceMinor, order.totals.currency)}
                    </p>
                    {item.selectedOptions.length ? (
                      <p>
                        {item.selectedOptions
                          .map(
                            (option) =>
                              `${option.key}: ${option.valueLabel ?? option.value}`,
                          )
                          .join(' · ')}
                      </p>
                    ) : null}
                    <p>
                      Print status:{' '}
                      <AdminStatusBadge status={item.itemPrintStatus} />
                    </p>
                    {item.printTechniques.length ? (
                      <p>Print technique: {item.printTechniques.join(', ')}</p>
                    ) : null}
                    {item.artwork ? (
                      <p>
                        Artwork: {item.artwork.originalFilename} ·{' '}
                        <AdminStatusBadge status={item.artwork.reviewStatus} />
                        {item.artwork.reviewNote
                          ? ` · ${item.artwork.reviewNote}`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                  <strong>
                    {formatMoney(item.lineTotalMinor, order.totals.currency)}
                  </strong>
                </article>
              ))}
            </div>
            <dl className="admin-order-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>
                  {formatMoney(
                    order.totals.subtotalMinor,
                    order.totals.currency,
                  )}
                </dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd>
                  {formatMoney(
                    order.totals.discountMinor,
                    order.totals.currency,
                  )}
                </dd>
              </div>
              <div>
                <dt>Shipping</dt>
                <dd>
                  {formatMoney(
                    order.totals.shippingMinor,
                    order.totals.currency,
                  )}
                </dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>
                  {formatMoney(order.totals.taxMinor, order.totals.currency)}
                </dd>
              </div>
              <div className="is-total">
                <dt>Total</dt>
                <dd>
                  {formatMoney(order.totals.totalMinor, order.totals.currency)}
                </dd>
              </div>
            </dl>
          </section>

          <div className="admin-order-detail-grid">
            <section className="admin-panel admin-order-detail-card">
              <h2>Order history</h2>
              {order.statusHistory.length ? (
                <ol className="admin-operation-list">
                  {order.statusHistory.map((event, index) => (
                    <li key={`${event.at}-${index}`}>
                      <strong>
                        {event.from.replaceAll('_', ' ')} →{' '}
                        {event.to.replaceAll('_', ' ')}
                      </strong>
                      <span className="admin-operation-subtext">
                        {formatDate(event.at)}
                        {event.actorName ? ` · ${event.actorName}` : ''}
                      </span>
                      {event.note ? <span>{event.note}</span> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No status changes recorded.</p>
              )}
            </section>
            <section className="admin-panel admin-order-detail-card">
              <h2>Internal notes</h2>
              {order.internalNotes.length ? (
                <ul className="admin-operation-list">
                  {order.internalNotes.map((note, index) => (
                    <li key={`${note.at}-${index}`}>
                      <strong>
                        {note.authorName ?? 'Staff'} · {formatDate(note.at)}
                      </strong>
                      <span>{note.note}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No internal notes.</p>
              )}
            </section>
            <section className="admin-panel admin-order-detail-card">
              <h2>Refund history</h2>
              {order.refunds.length ? (
                <ul className="admin-operation-list">
                  {order.refunds.map((item, index) => (
                    <li key={`${item.at}-${index}`}>
                      <strong>
                        {formatMoney(item.amountMinor, order.totals.currency)}
                      </strong>
                      <span>
                        {item.reason} · {formatDate(item.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No refunds recorded.</p>
              )}
            </section>
          </div>

          {can('orders:update_status') || can('orders:refund') ? (
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <h2>Order actions</h2>
                {can('orders:update_status') && order.status === 'shipped' ? (
                  <Button
                    disabled={completeOrder.isPending}
                    onClick={() => setConfirmComplete(true)}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    Mark completed
                  </Button>
                ) : null}
              </div>
              <OrderActions
                order={order}
                canUpdateStatus={can('orders:update_status')}
                statusPending={statusUpdate.isPending}
                cancelPending={cancelOrder.isPending}
                dispatchPending={dispatchOrder.isPending}
                notePending={addNote.isPending}
                refundPending={refund.isPending}
                canRefund={can('orders:refund')}
                error={
                  statusUpdate.error ??
                  cancelOrder.error ??
                  dispatchOrder.error ??
                  completeOrder.error ??
                  addNote.error ??
                  refund.error
                }
                onStatus={(status, note) =>
                  statusUpdate.mutate({ status, note })
                }
                onCancel={(input) => cancelOrder.mutate(input)}
                onDispatch={(input) => dispatchOrder.mutate(input)}
                onNote={(note) => addNote.mutate(note)}
                onRefund={(input) => refund.mutate(input)}
              />
            </section>
          ) : null}
          <AdminConfirmDialog
            open={confirmComplete}
            onClose={() => setConfirmComplete(false)}
            onConfirm={() => completeOrder.mutate()}
            title="Complete this order?"
          >
            This will mark the order completed. Confirm that fulfilment is
            finished.
          </AdminConfirmDialog>
        </>
      ) : null}
    </>
  );
}

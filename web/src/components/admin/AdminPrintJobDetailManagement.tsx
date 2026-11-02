'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdminConfirmDialog,
  AdminStatusBadge,
  PageHeader,
} from '@/components/admin';
import { usePermissions } from '@/components/providers/AuthProvider';
import { Button, ErrorState } from '@/components/ui';
import { api, ApiError } from '@/lib/api/client';
import type { AdminOrderDetail } from '@/lib/api/types';

const PRINT_STATUSES = [
  'queued',
  'printing',
  'printed',
  'quality_check',
  'ready',
] as const;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

function apiErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The request could not be completed.';
}

function getAddressLines(address: Record<string, string>): string[] {
  return [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter(Boolean);
}

function getOptions(item: AdminOrderDetail['items'][number]): string[] {
  return item.selectedOptions.map(
    (option) => `${option.key}: ${option.valueLabel ?? option.value}`,
  );
}

export function AdminPrintJobDetailManagement({
  orderId,
  itemId,
}: {
  orderId: string;
  itemId: string;
}) {
  const [selectedStatus, setSelectedStatus] =
    useState<(typeof PRINT_STATUSES)[number] | ''>('');
  const [confirmReady, setConfirmReady] = useState(false);
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['admin-order', orderId],
    queryFn: () => api.adminOrder(orderId),
    retry: false,
  });
  const updateStatus = useMutation({
    mutationFn: (status: (typeof PRINT_STATUSES)[number]) =>
      api.updateAdminPrintStatus(orderId, itemId, { status }),
    onSuccess: async () => {
      setSelectedStatus('');
      setConfirmReady(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-order', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['admin-print-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
      ]);
    },
  });
  const order = detail.data;
  const item = order?.items.find((entry) => entry.id === itemId);

  function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStatus || !can('orders:update_status')) return;
    if (selectedStatus === 'ready') {
      setConfirmReady(true);
      return;
    }
    updateStatus.mutate(selectedStatus);
  }

  return (
    <>
      <PageHeader
        title={item?.title ?? 'Print job details'}
        description={
          order ? `${order.orderNumber} · Received ${formatDate(order.createdAt)}` : undefined
        }
        actions={
          <Link
            className="button button--secondary button--md"
            href="/admin/print-queue"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to print queue
          </Link>
        }
      />
      {detail.isPending ? (
        <section className="admin-panel" role="status">
          Loading print job details…
        </section>
      ) : detail.isError ? (
        <section className="admin-panel">
          <ErrorState title="Print job details could not be loaded">
            {apiErrorMessage(detail.error)}
          </ErrorState>
          <Button variant="secondary" onClick={() => void detail.refetch()}>
            Try again
          </Button>
        </section>
      ) : !order || !item ? (
        <section className="admin-panel">
          <ErrorState title="Print job not found">
            This item is no longer available in the order.
          </ErrorState>
        </section>
      ) : (
        <>
          <div className="admin-print-detail-grid">
            <section className="admin-panel admin-print-detail-card">
              <h2>Job overview</h2>
              <dl className="admin-operation-metadata">
                <dt>Order reference</dt>
                <dd>{order.orderNumber}</dd>
                <dt>Order status</dt>
                <dd><AdminStatusBadge status={order.status} /></dd>
                <dt>Received</dt>
                <dd>{formatDate(order.createdAt)}</dd>
                <dt>Quantity</dt>
                <dd>{item.quantity}</dd>
                <dt>Production status</dt>
                <dd><AdminStatusBadge status={item.itemPrintStatus} /></dd>
              </dl>
            </section>
            <section className="admin-panel admin-print-detail-card">
              <h2>Customer</h2>
              <p><strong>{order.contact.name || 'Customer details unavailable'}</strong></p>
              <p><a href={`mailto:${order.contact.email}`}>{order.contact.email}</a></p>
              {order.contact.phone ? <p>{order.contact.phone}</p> : null}
              <div>
                <h3>Delivery address</h3>
                <address>
                  {getAddressLines(order.shippingAddress).map((line, index) => (
                    <span key={`${index}-${line}`}>{line}</span>
                  ))}
                </address>
              </div>
            </section>
            <section className="admin-panel admin-print-detail-card">
              <h2>Product and artwork</h2>
              <p><strong>{item.title}</strong></p>
              <p>SKU {item.sku}</p>
              {getOptions(item).length ? (
                <ul>
                  {getOptions(item).map((option) => <li key={option}>{option}</li>)}
                </ul>
              ) : null}
              {item.printTechniques.length ? (
                <p>Print techniques: {item.printTechniques.join(', ')}</p>
              ) : null}
              {item.artwork ? (
                <div>
                  <h3>Artwork</h3>
                  <p>{item.artwork.originalFilename}</p>
                  <p>{item.artwork.detectedMimeType}</p>
                  <p>Size: {item.artwork.sizeBytes} bytes</p>
                  <p>
                    Review status:{' '}
                    <AdminStatusBadge status={item.artwork.reviewStatus} />
                  </p>
                  {item.artwork.reviewNote ? <p>{item.artwork.reviewNote}</p> : null}
                </div>
              ) : (
                <p>No customer artwork is attached to this item.</p>
              )}
            </section>
          </div>
          <div className="admin-print-detail-grid">
            <section className="admin-panel admin-print-detail-card">
              <h2>Order status history</h2>
              {order.statusHistory.length ? (
                <ol className="admin-operation-list">
                  {order.statusHistory.map((entry, index) => (
                    <li key={`${entry.at}-${index}`}>
                      <strong>
                        {entry.from.replaceAll('_', ' ')} → {entry.to.replaceAll('_', ' ')}
                      </strong>
                      <span className="admin-operation-subtext">
                        {formatDate(entry.at)}
                        {entry.actorName ? ` · ${entry.actorName}` : ''}
                      </span>
                      {entry.note ? <span>{entry.note}</span> : null}
                    </li>
                  ))}
                </ol>
              ) : <p>No order status history is available.</p>}
            </section>
            <section className="admin-panel admin-print-detail-card">
              <h2>Order notes</h2>
              {order.internalNotes.length ? (
                <ul className="admin-operation-list">
                  {order.internalNotes.map((entry, index) => (
                    <li key={`${entry.at}-${index}`}>
                      <strong>
                        {entry.authorName ?? 'Staff'} · {formatDate(entry.at)}
                      </strong>
                      <span>{entry.note}</span>
                    </li>
                  ))}
                </ul>
              ) : order.customerNote ? (
                <p>{order.customerNote}</p>
              ) : (
                <p>No notes are available for this job.</p>
              )}
            </section>
          </div>
          {can('orders:update_status') ? (
            <section className="admin-panel admin-print-detail-card">
              <h2>Update production status</h2>
              <p>
                Status changes are available only while the order is in
                production or ready for fulfilment.
              </p>
              {order.status === 'in_printing' || order.status === 'ready' ? (
                <form className="admin-print-status-form" onSubmit={submitStatus}>
                  <label>
                    Production status
                    <select
                      className="input"
                      value={selectedStatus}
                      onChange={(event) =>
                        setSelectedStatus(
                          PRINT_STATUSES.includes(
                            event.currentTarget.value as (typeof PRINT_STATUSES)[number],
                          )
                            ? (event.currentTarget.value as (typeof PRINT_STATUSES)[number])
                            : '',
                        )
                      }
                    >
                      <option value="">Choose status</option>
                      {PRINT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="submit"
                    disabled={!selectedStatus || updateStatus.isPending}
                    aria-label="Update production status"
                    title="Update production status"
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                  </Button>
                </form>
              ) : (
                <p role="status">
                  Production status cannot be changed while this order is{' '}
                  {order.status.replaceAll('_', ' ')}.
                </p>
              )}
              {updateStatus.error ? (
                <p className="admin-operation-error" role="alert">
                  {apiErrorMessage(updateStatus.error)}
                </p>
              ) : null}
            </section>
          ) : null}
          <AdminConfirmDialog
            open={confirmReady}
            onClose={() => setConfirmReady(false)}
            onConfirm={() => {
              if (selectedStatus === 'ready') updateStatus.mutate(selectedStatus);
            }}
            title="Mark this print job ready?"
          >
            Marking this item ready may advance its order when all other items
            are also ready.
          </AdminConfirmDialog>
        </>
      )}
    </>
  );
}

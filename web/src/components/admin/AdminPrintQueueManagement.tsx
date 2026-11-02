'use client';

import { useRouter } from 'next/navigation';
import { Eye, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminStatusBadge, PageHeader } from '@/components/admin';
import { AdminIconButton } from '@/components/admin/AdminIconButton';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api/client';
import type { AdminPrintQueueItem } from '@/lib/api/types';

const PAGE_SIZE = 25;

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

function formatOptions(item: AdminPrintQueueItem): string {
  return item.selectedOptions
    .map(
      (option) => `${option.key}: ${option.valueLabel ?? option.value ?? ''}`,
    )
    .filter((option) => !option.endsWith(': '))
    .join(' · ');
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

export function AdminPrintQueueManagement() {
  const [status, setStatus] = useState('');
  const [technique, setTechnique] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const router = useRouter();
  const queue = useQuery({
    queryKey: ['admin-print-queue', { status, technique, query, page }],
    queryFn: () =>
      api.adminPrintQueue({
        ...(status ? { status } : {}),
        ...(technique.trim() ? { technique: technique.trim() } : {}),
        ...(query ? { q: query } : {}),
        page,
        limit: PAGE_SIZE,
      }),
    retry: false,
  });
  const items = queue.data?.items ?? [];
  const allVisibleSelected =
    items.length > 0 && items.every((item) => selectedIds.has(item.itemId));

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(search.trim());
    setPage(1);
  }

  function openJob(item: AdminPrintQueueItem) {
    router.push(
      `/admin/print-queue/${encodeURIComponent(item.orderId)}/${encodeURIComponent(item.itemId)}`,
    );
  }

  return (
    <>
      <PageHeader
        title="Print queue"
        description="Track production progress for paid orders."
      />
      <form className="admin-filter-bar" onSubmit={submitSearch}>
        <label>
          Search jobs
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Order, customer or product"
          />
        </label>
        <label>
          Order status
          <select
            className="input"
            value={status}
            onChange={(event) => {
              setStatus(event.currentTarget.value);
              setPage(1);
            }}
          >
            <option value="">In printing and ready</option>
            <option value="in_printing">In printing</option>
            <option value="ready">Ready</option>
          </select>
        </label>
        <label>
          Print technique
          <input
            className="input"
            value={technique}
            onChange={(event) => {
              setTechnique(event.currentTarget.value);
              setPage(1);
            }}
            placeholder="Filter by technique"
          />
        </label>
        <Button type="submit">Search</Button>
      </form>

      <section className="admin-panel" aria-labelledby="print-queue-title">
        <div className="admin-panel-heading">
          <div>
            <h2 id="print-queue-title">Production jobs</h2>
            <p>
              {queue.data
                ? `${queue.data.pagination.total} print jobs`
                : 'Print jobs'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Refresh print queue"
            onClick={() => void queue.refetch()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </Button>
        </div>
        <div className="admin-orders-table-wrap">
          <table className="admin-orders-table admin-print-queue-table">
            <thead>
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all print jobs on this page"
                    checked={allVisibleSelected}
                    disabled={!items.length || queue.isError}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        for (const item of items) {
                          if (checked) next.add(item.itemId);
                          else next.delete(item.itemId);
                        }
                        return next;
                      });
                    }}
                  />
                </th>
                <th scope="col">Order / job</th>
                <th scope="col">Customer</th>
                <th scope="col">Product / artwork</th>
                <th scope="col">Quantity</th>
                <th scope="col">Date received</th>
                <th scope="col">Production status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.isError ? (
                <tr className="admin-orders-state-row">
                  <td colSpan={8}>
                    <div className="admin-orders-error" role="alert">
                      <div>
                        <strong>Print jobs could not be loaded</strong>
                        <p>{apiErrorMessage(queue.error)}</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void queue.refetch()}
                      >
                        Try again
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : queue.isPending ? (
                <tr className="admin-orders-state-row">
                  <td colSpan={8} role="status">
                    Loading print jobs…
                  </td>
                </tr>
              ) : items.length ? (
                items.map((item) => (
                  <tr
                    key={item.itemId}
                    tabIndex={0}
                    aria-label={`View print job for ${item.productTitle}, order ${item.orderNumber}`}
                    onClick={() => openJob(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openJob(item);
                      }
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select print job ${item.orderNumber} ${item.productTitle}`}
                        checked={selectedIds.has(item.itemId)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (checked) next.add(item.itemId);
                            else next.delete(item.itemId);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="admin-orders-table-number">
                      <strong>{item.orderNumber}</strong>
                      <small className="admin-operation-subtext">
                        {item.itemId}
                      </small>
                    </td>
                    <td>
                      {item.customerName || 'Customer details unavailable'}
                    </td>
                    <td>
                      <strong>{item.productTitle}</strong>
                      {formatOptions(item) ? (
                        <small className="admin-operation-subtext">
                          {formatOptions(item)}
                        </small>
                      ) : null}
                      {item.printTechniques.length ? (
                        <small className="admin-operation-subtext">
                          {item.printTechniques.join(', ')}
                        </small>
                      ) : null}
                      {item.artworkId ? (
                        <small className="admin-operation-subtext">
                          Artwork ·{' '}
                          <AdminStatusBadge
                            status={item.artworkReviewStatus ?? 'pending'}
                          />
                        </small>
                      ) : null}
                    </td>
                    <td>{item.quantity}</td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>
                      <AdminStatusBadge status={item.itemPrintStatus} />
                    </td>
                    <td>
                      <AdminIconButton
                        label={`View print job for ${item.productTitle}, order ${item.orderNumber}`}
                        onClick={() => openJob(item)}
                      >
                        <Eye size={16} aria-hidden="true" />
                      </AdminIconButton>
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="admin-orders-state-row">
                  <td colSpan={8}>
                    <div className="admin-orders-empty" role="status">
                      <strong>
                        {query || technique.trim() || status
                          ? 'No print jobs match these filters.'
                          : 'No print jobs yet'}
                      </strong>
                      <p>
                        {query || technique.trim() || status
                          ? 'Try changing your search or filters.'
                          : 'Jobs for orders in production will appear here.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {queue.data ? (
          <Pagination
            page={queue.data.pagination.page}
            totalPages={queue.data.pagination.totalPages}
            hasNextPage={queue.data.pagination.hasNextPage}
            onPage={setPage}
          />
        ) : null}
      </section>
    </>
  );
}

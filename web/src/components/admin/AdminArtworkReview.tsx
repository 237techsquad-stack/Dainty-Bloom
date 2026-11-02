'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { AdminStatusBadge, PageHeader } from '@/components/admin';
import { Button, ErrorState } from '@/components/ui';
import { ApiError, api } from '@/lib/api/client';
import { usePermissions } from '@/components/providers/AuthProvider';
import type { AdminArtworkListItem } from '@/lib/api/types';

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'The request could not be completed.';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
}

export function AdminArtworkReview() {
  const [status, setStatus] = useState('pending');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const artwork = useQuery({
    queryKey: ['admin-artwork', { status, orderNumber, from, to, page }],
    queryFn: () =>
      api.adminArtwork({
        page,
        limit: 25,
        ...(status ? { reviewStatus: status } : {}),
        ...(orderNumber.trim() ? { orderNumber: orderNumber.trim() } : {}),
        ...(from ? { from: `${from}T00:00:00.000Z` } : {}),
        ...(to ? { to: `${to}T23:59:59.999Z` } : {}),
      }),
    retry: false,
  });
  const review = useMutation({
    mutationFn: (input: {
      id: string;
      decision: 'approved' | 'replacement_requested';
      note?: string;
    }) =>
      api.reviewAdminArtwork(input.id, {
        decision: input.decision,
        ...(input.note ? { note: input.note } : {}),
      }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-artwork'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: setError,
  });
  const items = artwork.data?.items ?? [];

  function decision(
    item: AdminArtworkListItem,
    value: 'approved' | 'replacement_requested',
  ) {
    const note = notes[item.id]?.trim();
    if (value === 'replacement_requested' && !note) {
      setError(new Error('Add a note before requesting a replacement.'));
      return;
    }
    review.mutate({
      id: item.id,
      decision: value,
      ...(note ? { note } : {}),
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrderNumber(orderSearch.trim());
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Artwork review"
        description="Review customer artwork through private, access-controlled file routes."
        actions={
          <Button
            variant="secondary"
            aria-label="Refresh artwork"
            onClick={() => void artwork.refetch()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </Button>
        }
      />
      <form className="admin-filter-bar" onSubmit={submitSearch}>
        <label>
          Review status
          <select
            className="input"
            value={status}
            onChange={(event) => {
              setStatus(event.currentTarget.value);
              setPage(1);
            }}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="replacement_requested">Replacement requested</option>
            <option value="">All statuses</option>
          </select>
        </label>
        <label>
          Order number
          <input
            className="input"
            value={orderSearch}
            onChange={(event) => {
              setOrderSearch(event.currentTarget.value);
            }}
            placeholder="Filter by order number"
          />
        </label>
        <label>
          Received from
          <input
            className="input"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => {
              setFrom(event.currentTarget.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Received to
          <input
            className="input"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => {
              setTo(event.currentTarget.value);
              setPage(1);
            }}
          />
        </label>
        <Button type="submit">Search</Button>
      </form>
      {error ? (
        <p className="admin-operation-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
      <section
        className="admin-panel"
        aria-labelledby="artwork-review-list-title"
      >
        <div className="admin-panel-heading">
          <div>
            <h2 id="artwork-review-list-title">Artwork queue</h2>
            <p>
              {artwork.data
                ? `${artwork.data.pagination.total} artwork files`
                : 'Customer artwork'}
            </p>
          </div>
        </div>
        {artwork.isError ? (
          <div className="admin-artwork-error">
            <ErrorState title="Artwork could not be loaded">
              {errorMessage(artwork.error)}
            </ErrorState>
            <Button variant="secondary" onClick={() => void artwork.refetch()}>
              Try again
            </Button>
          </div>
        ) : artwork.isPending ? (
          <p role="status">Loading artwork…</p>
        ) : items.length ? (
          <div className="admin-operation-cards">
            {items.map((item) => (
              <article className="admin-operation-card" key={item.id}>
                <div className="admin-panel-heading">
                  <div>
                    <h2>{item.productTitle ?? item.originalFilename}</h2>
                    <p>
                      {item.orderNumber ? `Order ${item.orderNumber} · ` : ''}
                      {formatDate(item.createdAt)}
                    </p>
                  </div>
                  <AdminStatusBadge status={item.reviewStatus} />
                </div>
                <dl className="admin-operation-metadata">
                  <dt>File</dt>
                  <dd>{item.originalFilename}</dd>
                  <dt>Type</dt>
                  <dd>{item.detectedMimeType}</dd>
                  <dt>Size</dt>
                  <dd>{(item.sizeBytes / 1024 / 1024).toFixed(2)} MB</dd>
                  {item.width && item.height ? (
                    <>
                      <dt>Dimensions</dt>
                      <dd>
                        {item.width} × {item.height}px
                      </dd>
                    </>
                  ) : null}
                  {item.reviewNote ? (
                    <>
                      <dt>Review note</dt>
                      <dd>{item.reviewNote}</dd>
                    </>
                  ) : null}
                </dl>
                <a
                  className="button button--secondary"
                  href={`/api/artwork/${encodeURIComponent(item.id)}/file`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open private artwork file
                </a>
                {item.reviewStatus === 'pending' && can('artwork:review') ? (
                  <div className="admin-operation-actions">
                    <label>
                      Note for replacement request
                      <textarea
                        className="input"
                        rows={3}
                        maxLength={2000}
                        value={notes[item.id] ?? ''}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [item.id]: event.currentTarget.value,
                          }))
                        }
                      />
                    </label>
                    <div className="button-row">
                      <Button
                        onClick={() => decision(item, 'approved')}
                        disabled={review.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => decision(item, 'replacement_requested')}
                        disabled={review.isPending}
                      >
                        Request replacement
                      </Button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-artwork-empty" role="status">
            <strong>
              {status || orderNumber.trim() || from || to
                ? 'No artwork files match these filters.'
                : 'No artwork files yet.'}
            </strong>
            <p>
              {status || orderNumber.trim() || from || to
                ? 'Try changing the review status, order number, or received date range.'
                : 'Customer artwork submitted with orders will appear here.'}
            </p>
          </div>
        )}
        {artwork.data ? (
          <div className="admin-operation-pagination">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </Button>
            <span>
              Page {artwork.data.pagination.page} of{' '}
              {Math.max(1, artwork.data.pagination.totalPages)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!artwork.data.pagination.hasNextPage}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </section>
    </>
  );
}

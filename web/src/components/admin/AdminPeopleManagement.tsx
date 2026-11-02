'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, RefreshCw } from 'lucide-react';
import { AdminStatusBadge, DataTable, PageHeader } from '@/components/admin';
import { AdminIconButton } from '@/components/admin/AdminIconButton';
import { Button, ErrorState } from '@/components/ui';
import { useAuth, usePermissions } from '@/components/providers/AuthProvider';
import { ApiError, api } from '@/lib/api/client';
import type { AdminReviewListItem } from '@/lib/api/types';
import { formatMoney } from '@/lib/utils/formatMoney';

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

export function AdminCustomersManagement({
  initialQuery = '',
}: {
  initialQuery?: string;
}) {
  const [search, setSearch] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const customers = useQuery({
    queryKey: ['admin-customers', { query, page }],
    queryFn: () => api.adminCustomers({ q: query, page, limit: 25 }),
    retry: false,
  });
  const items = customers.data?.items ?? [];
  const customerId = items.some((item) => item._id === selectedId)
    ? selectedId
    : (items[0]?._id ?? '');
  const detail = useQuery({
    queryKey: ['admin-customer', customerId],
    queryFn: () => api.adminCustomer(customerId),
    enabled: Boolean(customerId),
    retry: false,
  });

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(search.trim());
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Customers"
        description="View customer account details and order history."
      />
      <form className="admin-filter-bar" onSubmit={submitSearch}>
        <label>
          Search customers
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Name or email"
          />
        </label>
        <Button type="submit">Search</Button>
      </form>
      <div className="admin-operation-layout">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Customer list</h2>
              <p>
                {customers.data
                  ? `${customers.data.pagination.total} customers`
                  : 'Customers'}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Refresh customers"
              onClick={() => void customers.refetch()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              <span>Refresh</span>
            </Button>
          </div>
          <div className="admin-customers-table-wrap">
            <table className="admin-customers-table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Account</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {customers.isError ? (
                  <tr className="admin-customers-state-row">
                    <td colSpan={4}>
                      <div className="admin-customers-error" role="alert">
                        <div>
                          <strong>Customers could not be loaded</strong>
                          <p>{errorMessage(customers.error)}</p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void customers.refetch()}
                        >
                          Try again
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : customers.isPending ? (
                  <tr className="admin-customers-state-row">
                    <td colSpan={4} role="status">
                      Loading customers…
                    </td>
                  </tr>
                ) : items.length ? (
                  items.map((item) => (
                    <tr key={item._id}>
                      <td>
                        <strong>{item.name}</strong>
                        <small className="admin-operation-subtext">
                          {item.email}
                        </small>
                      </td>
                      <td>{item.orderCount}</td>
                      <td>
                        <AdminStatusBadge status={item.accountState} />
                      </td>
                      <td>
                        <AdminIconButton
                          label={`View ${item.name}'s customer details`}
                          aria-pressed={item._id === customerId}
                          onClick={() => setSelectedId(item._id)}
                        >
                          <Eye size={16} aria-hidden="true" />
                        </AdminIconButton>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="admin-customers-state-row">
                    <td colSpan={4}>
                      <div className="admin-customers-empty" role="status">
                        <strong>
                          {query
                            ? 'No customers match your search.'
                            : 'No customers yet.'}
                        </strong>
                        <p>
                          {query
                            ? 'Try another name or email address.'
                            : 'Customer accounts will appear here.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {customers.data ? (
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
                Page {customers.data.pagination.page} of{' '}
                {Math.max(1, customers.data.pagination.totalPages)}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!customers.data.pagination.hasNextPage}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </section>
        <section
          className="admin-panel admin-operation-detail"
          aria-labelledby="customer-details-heading"
        >
          {detail.isPending && customerId ? (
            <p role="status">Loading customer details…</p>
          ) : detail.isError ? (
            <>
              <ErrorState title="Customer details could not be loaded">
                {errorMessage(detail.error)}
              </ErrorState>
              <Button variant="secondary" onClick={() => void detail.refetch()}>
                Try again
              </Button>
            </>
          ) : detail.data ? (
            <>
              <div className="admin-panel-heading">
                <div>
                  <h2 id="customer-details-heading">
                    {detail.data.customer.name}
                  </h2>
                  <p>
                    <a href={`mailto:${detail.data.customer.email}`}>
                      {detail.data.customer.email}
                    </a>
                  </p>
                </div>
                <AdminStatusBadge status={detail.data.customer.accountState} />
              </div>
              <dl className="admin-operation-metadata">
                <dt>Phone</dt>
                <dd>{detail.data.customer.phone || 'Not provided'}</dd>
                <dt>Email verified</dt>
                <dd>{detail.data.customer.emailVerified ? 'Yes' : 'No'}</dd>
                <dt>Customer since</dt>
                <dd>{formatDate(detail.data.customer.createdAt)}</dd>
              </dl>
              <h3>Saved addresses</h3>
              {detail.data.customer.addresses.length ? (
                <ul className="admin-operation-list">
                  {detail.data.customer.addresses.map((address, index) => (
                    <li key={`${address.label}-${index}`}>
                      <strong>
                        {address.label}
                        {address.isDefault ? ' (default)' : ''}
                      </strong>
                      <span className="admin-operation-subtext">
                        {[
                          address.line1,
                          address.line2,
                          address.city,
                          address.state,
                          address.postalCode,
                          address.country,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No saved addresses.</p>
              )}
              <h3>Order history</h3>
              {detail.data.orders.length ? (
                <DataTable
                  columns={[
                    { key: 'order', label: 'Order' },
                    { key: 'date', label: 'Date' },
                    { key: 'total', label: 'Total' },
                    { key: 'status', label: 'Status' },
                    { key: 'payment', label: 'Payment' },
                  ]}
                  rows={detail.data.orders.map((order) => ({
                    id: order._id,
                    values: {
                      order: order.orderNumber,
                      date: formatDate(order.createdAt),
                      total: formatMoney(order.totalMinor, order.currency),
                      status: <AdminStatusBadge status={order.status} />,
                      payment: (
                        <AdminStatusBadge status={order.payment.status} />
                      ),
                    },
                  }))}
                />
              ) : (
                <p>No orders have been placed.</p>
              )}
            </>
          ) : (
            <p role="status">Select a customer to view their details.</p>
          )}
        </section>
      </div>
    </>
  );
}

export function AdminReviewsManagement() {
  const [status, setStatus] = useState('');
  const [rating, setRating] = useState('');
  const [page, setPage] = useState(1);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const reviews = useQuery({
    queryKey: ['admin-reviews', { status, rating, page }],
    queryFn: () =>
      api.adminReviews({
        page,
        limit: 25,
        ...(status ? { moderationState: status } : {}),
        ...(rating ? { rating: Number(rating) } : {}),
      }),
    retry: false,
  });
  const moderate = useMutation({
    mutationFn: (input: {
      id: string;
      decision: 'approved' | 'rejected';
      reason?: string;
    }) =>
      api.moderateAdminReview(input.id, {
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
    },
    onError: setError,
  });
  const items = reviews.data?.items ?? [];

  function submitDecision(
    item: AdminReviewListItem,
    decision: 'approved' | 'rejected',
  ) {
    const reason = reasons[item.id]?.trim();
    if (decision === 'rejected' && !reason) {
      setError(new Error('Add a reason before rejecting a review.'));
      return;
    }
    moderate.mutate({ id: item.id, decision, ...(reason ? { reason } : {}) });
  }

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Moderate customer product reviews before publication."
        actions={
          <Button
            variant="secondary"
            aria-label="Refresh reviews"
            onClick={() => void reviews.refetch()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </Button>
        }
      />
      <div className="admin-filter-bar">
        <label>
          Moderation status
          <select
            className="input"
            value={status}
            onChange={(event) => {
              setStatus(event.currentTarget.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label>
          Rating
          <select
            className="input"
            value={rating}
            onChange={(event) => {
              setRating(event.currentTarget.value);
              setPage(1);
            }}
          >
            <option value="">All ratings</option>
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {value} stars
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p className="admin-operation-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
      <section className="admin-panel" aria-labelledby="reviews-list-title">
        <div className="admin-panel-heading">
          <div>
            <h2 id="reviews-list-title">Review queue</h2>
            <p>
              {reviews.data
                ? `${reviews.data.pagination.total} reviews`
                : 'Customer product reviews'}
            </p>
          </div>
        </div>
        {reviews.isError ? (
          <div className="admin-reviews-error">
            <div>
              <ErrorState title="Reviews could not be loaded">
                {errorMessage(reviews.error)}
              </ErrorState>
            </div>
            <Button variant="secondary" onClick={() => void reviews.refetch()}>
              Try again
            </Button>
          </div>
        ) : reviews.isPending ? (
          <p role="status">Loading reviews…</p>
        ) : items.length ? (
          <div className="admin-operation-cards">
            {items.map((item) => (
              <article className="admin-operation-card" key={item.id}>
                <div className="admin-panel-heading">
                  <div>
                    <h2>{item.title}</h2>
                    <p>
                      {item.product?.title ?? 'Product unavailable'} ·{' '}
                      {item.reviewer?.name ?? 'Customer unavailable'} ·{' '}
                      {formatDate(item.createdAt)}
                    </p>
                  </div>
                  <AdminStatusBadge status={item.moderationState} />
                </div>
                <p aria-label={`${item.rating} out of 5 stars`}>
                  {item.rating} / 5 stars
                </p>
                <p className="admin-operation-review-body">{item.body}</p>
                {item.reviewer?.email ? (
                  <a href={`mailto:${item.reviewer.email}`}>
                    {item.reviewer.email}
                  </a>
                ) : null}
                {item.moderationReason ? (
                  <p>
                    <strong>Moderation reason:</strong> {item.moderationReason}
                  </p>
                ) : null}
                {item.moderationState === 'pending' &&
                can('reviews:moderate') ? (
                  <div className="admin-operation-actions">
                    <label>
                      Rejection reason (required to reject)
                      <textarea
                        className="input"
                        rows={2}
                        maxLength={1000}
                        value={reasons[item.id] ?? ''}
                        onChange={(event) =>
                          setReasons((current) => ({
                            ...current,
                            [item.id]: event.currentTarget.value,
                          }))
                        }
                      />
                    </label>
                    <div className="button-row">
                      <Button
                        onClick={() => submitDecision(item, 'approved')}
                        disabled={moderate.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => submitDecision(item, 'rejected')}
                        disabled={moderate.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-reviews-empty" role="status">
            <strong>
              {status || rating
                ? 'No reviews match these filters.'
                : 'No reviews yet.'}
            </strong>
            <p>
              {status || rating
                ? 'Try changing the moderation status or rating.'
                : 'Customer product reviews will appear here.'}
            </p>
          </div>
        )}
        {reviews.data ? (
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
              Page {reviews.data.pagination.page} of{' '}
              {Math.max(1, reviews.data.pagination.totalPages)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!reviews.data.pagination.hasNextPage}
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

export function AdminStaffManagement() {
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState('');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const staff = useQuery({
    queryKey: ['admin-staff', page],
    queryFn: () => api.adminStaff({ page, limit: 25 }),
    retry: false,
  });
  const invalidate = async () => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
  };
  const create = useMutation({
    mutationFn: (input: {
      name: string;
      email: string;
      role: 'admin' | 'production' | 'support';
    }) => api.createAdminStaff(input),
    onSuccess: async () => {
      setSuccess('Staff account created and password-reset flow initiated.');
      await invalidate();
    },
    onError: (reason) => {
      setSuccess('');
      setError(reason);
    },
  });
  const update = useMutation({
    mutationFn: (input: {
      id: string;
      role?: 'admin' | 'production' | 'support';
      accountState?: 'active' | 'suspended';
    }) =>
      api.updateAdminStaff(input.id, {
        ...(input.role ? { role: input.role } : {}),
        ...(input.accountState ? { accountState: input.accountState } : {}),
      }),
    onSuccess: async () => {
      setSuccess('Staff access updated.');
      await invalidate();
    },
    onError: (reason) => {
      setSuccess('');
      setError(reason);
    },
  });

  function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const role = String(data.get('role') ?? 'production');
    if (name && email && ['admin', 'production', 'support'].includes(role)) {
      create.mutate(
        { name, email, role: role as 'admin' | 'production' | 'support' },
        { onSuccess: () => form.reset() },
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Staff"
        description="Manage staff access using the existing role and account safeguards."
      />
      <section className="admin-panel">
        <h2>Invite staff member</h2>
        <p>
          The staff member will receive a password-reset email; passwords are
          never displayed here.
        </p>
        <form className="admin-operation-form" onSubmit={createStaff}>
          <label>
            Name
            <input
              className="input"
              name="name"
              required
              minLength={1}
              maxLength={120}
            />
          </label>
          <label>
            Email
            <input
              className="input"
              name="email"
              type="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Role
            <select className="input" name="role" defaultValue="production">
              <option value="production">Production</option>
              <option value="support">Support</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Sending invite…' : 'Create staff account'}
          </Button>
        </form>
      </section>
      {error ? (
        <p className="admin-operation-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
      {success ? (
        <p className="admin-operation-success" role="status">
          {success}
        </p>
      ) : null}
      {staff.isPending ? (
        <section className="admin-panel" role="status">
          Loading staff…
        </section>
      ) : staff.isError ? (
        <section className="admin-panel">
          <ErrorState title="Staff could not be loaded">
            {errorMessage(staff.error)}
          </ErrorState>
          <Button variant="secondary" onClick={() => void staff.refetch()}>
            Try again
          </Button>
        </section>
      ) : (
        <section className="admin-panel">
          <DataTable
            emptyTitle="No staff accounts found"
            columns={[
              { key: 'staff', label: 'Staff member' },
              { key: 'role', label: 'Role' },
              { key: 'state', label: 'Account state' },
              { key: 'verified', label: 'Email verified' },
              { key: 'created', label: 'Created' },
            ]}
            rows={staff.data.items.map((item) => {
              const isSelf = item.id === user?.id;
              return {
                id: item.id,
                values: {
                  staff: (
                    <>
                      <strong>{item.name}</strong>
                      <small className="admin-operation-subtext">
                        {item.email}
                        {isSelf ? ' · You' : ''}
                      </small>
                    </>
                  ),
                  role: (
                    <select
                      className="input"
                      aria-label={`Role for ${item.name}`}
                      value={item.role}
                      disabled={isSelf || update.isPending}
                      onChange={(event) => {
                        const role = event.currentTarget.value;
                        if (['admin', 'production', 'support'].includes(role)) {
                          update.mutate({
                            id: item.id,
                            role: role as 'admin' | 'production' | 'support',
                          });
                        }
                      }}
                    >
                      <option value="admin">Admin</option>
                      <option value="production">Production</option>
                      <option value="support">Support</option>
                    </select>
                  ),
                  state: (
                    <select
                      className="input"
                      aria-label={`Account state for ${item.name}`}
                      value={item.accountState}
                      disabled={isSelf || update.isPending}
                      onChange={(event) => {
                        const accountState = event.currentTarget.value;
                        if (
                          accountState === 'active' ||
                          accountState === 'suspended'
                        ) {
                          update.mutate({ id: item.id, accountState });
                        }
                      }}
                    >
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  ),
                  verified: item.emailVerified ? 'Yes' : 'No',
                  created: formatDate(item.createdAt),
                },
              };
            })}
          />
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
              Page {staff.data.pagination.page} of{' '}
              {Math.max(1, staff.data.pagination.totalPages)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!staff.data.pagination.hasNextPage}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </section>
      )}
    </>
  );
}

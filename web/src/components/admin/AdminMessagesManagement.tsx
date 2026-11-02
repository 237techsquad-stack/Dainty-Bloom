'use client';

import Image from 'next/image';
import { useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminStatusBadge, PageHeader } from '@/components/admin';
import { Button, ErrorState } from '@/components/ui';
import { api, ApiError } from '@/lib/api/client';
import type {
  AdminMessageListItem,
  AdminMessageStatus,
  AdminMessageType,
  AdminCategory,
  CustomOfferProductType,
  CustomOfferSummary,
  CustomRequestStatus,
} from '@/lib/api/types';

const MESSAGE_TYPES: Array<{ value: '' | AdminMessageType; label: string }> = [
  { value: 'custom_3d_request', label: 'Custom product requests' },
  { value: '', label: 'All messages' },
  { value: 'general', label: 'General enquiries' },
  { value: 'bulk_quote', label: 'Bulk quote requests' },
];

const MESSAGE_STATUSES: Array<{
  value: '' | AdminMessageStatus;
  label: string;
}> = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'resolved', label: 'Resolved' },
];

function formatDate(value: string | undefined): string {
  if (!value) return 'Not provided';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

function messageTypeLabel(type: AdminMessageType): string {
  if (type === 'custom_3d_request') return 'Custom product request';
  if (type === 'bulk_quote') return 'Bulk quote';
  return 'General enquiry';
}

function customRequestStatusLabel(status: CustomRequestStatus | null): string {
  const labels: Record<CustomRequestStatus, string> = {
    submitted: 'Submitted',
    under_review: 'Under review',
    accepted: 'Accepted',
    declined: 'Declined',
    offer_created: 'Offer created',
    completed: 'Completed',
  };
  return status ? labels[status] : 'Not a custom request';
}

function notificationStatusLabel(
  status: 'pending' | 'sent' | 'failed',
): string {
  if (status === 'sent') return 'Email sent';
  if (status === 'failed') return 'Email failed — response remains saved';
  return 'Email pending';
}

function imagePurposeLabel(
  purpose: NonNullable<AdminMessageListItem['requestDetails']>['imagePurpose'],
): string {
  switch (purpose) {
    case 'no_image':
      return 'No image — idea described in the request';
    case 'my_design':
      return 'Customer design — intended for the custom product';
    case 'reference':
      return 'Reference image — inspiration for a unique result';
    case 'example':
      return 'Example image — customer explains desired details';
    default:
      return 'Purpose not specified (older request)';
  }
}

function emailDeliveryLabel(
  status: AdminMessageListItem['emailDeliveryStatus'],
) {
  const labels: Record<AdminMessageListItem['emailDeliveryStatus'], string> = {
    not_tracked: 'Not tracked (legacy enquiry)',
    not_required: 'Not sent for this request type',
    pending: 'Pending',
    sent: 'Accepted by SMTP (delivery not confirmed)',
    failed: 'Failed',
  };
  return labels[status];
}

const PRIVATE_OFFER_PRODUCT_TYPES: Array<{
  value: CustomOfferProductType;
  label: string;
}> = [
  { value: 'tshirt', label: 'T-shirt' },
  { value: 'mug', label: 'Mug' },
  { value: 'canvas_paint_yourself', label: 'Paint-it-yourself canvas' },
  { value: 'canvas_custom_print', label: 'Custom canvas print' },
  { value: 'three_d_printed', label: '3D-printed product' },
  { value: 'hoodie', label: 'Hoodie' },
  { value: 'canvas', label: 'Canvas' },
  { value: 'poster', label: 'Poster' },
  { value: 'tote_bag', label: 'Tote bag' },
  { value: 'banner', label: 'Banner' },
  { value: 'signage', label: 'Signage' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'other', label: 'Other' },
];

function flattenActiveCategories(
  categories: AdminCategory[],
): Array<{ id: string; name: string }> {
  return categories.flatMap((category) => [
    ...(category.isActive ? [{ id: category._id, name: category.name }] : []),
    ...flattenActiveCategories(category.children),
  ]);
}

function formatOfferPrice(offer: CustomOfferSummary): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: offer.currency,
  }).format(offer.agreedPriceMinor / 100);
}

function offerStatusLabel(status: CustomOfferSummary['status']): string {
  const labels: Record<CustomOfferSummary['status'], string> = {
    available: 'Created — not purchasable yet',
    reserved: 'Reserved',
    purchased: 'Purchased',
    expired: 'Expired',
    cancelled: 'Cancelled',
  };
  return labels[status];
}

export function AdminMessagesManagement() {
  const [type, setType] = useState<'' | AdminMessageType>('custom_3d_request');
  const [status, setStatus] = useState<'' | AdminMessageStatus>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [customResponseMessage, setCustomResponseMessage] = useState('');
  const [customResponseError, setCustomResponseError] = useState('');
  const [offerFormError, setOfferFormError] = useState('');
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: api.adminCategories,
    retry: false,
  });
  const availableCategories = flattenActiveCategories(categories.data ?? []);
  const filters = {
    page,
    limit: 25,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(query ? { q: query } : {}),
  };
  const messages = useQuery({
    queryKey: ['admin-messages', filters],
    queryFn: () => api.adminMessages(filters),
    retry: false,
  });
  const items = messages.data?.items ?? [];
  const activeId = items.some((item) => item.id === selectedId)
    ? selectedId
    : (items[0]?.id ??
      (messages.isPending || messages.isError ? selectedId : ''));
  const selectedMessage = useQuery({
    queryKey: ['admin-message', activeId],
    queryFn: () => api.adminMessage(activeId),
    enabled: Boolean(activeId),
    retry: false,
  });
  const updateStatus = useMutation({
    mutationFn: (input: { id: string; status: AdminMessageStatus }) =>
      api.updateAdminMessage(input.id, { status: input.status }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-messages'] }),
        queryClient.invalidateQueries({
          queryKey: ['admin-message', variables.id],
        }),
      ]);
    },
  });
  const reply = useMutation({
    mutationFn: (input: {
      id: string;
      body: string;
      quotedPriceMinor?: number;
      note?: string;
    }) =>
      api.replyAdminMessage(input.id, {
        body: input.body,
        ...(input.quotedPriceMinor !== undefined
          ? { quotedPriceMinor: input.quotedPriceMinor }
          : {}),
        ...(input.note ? { note: input.note } : {}),
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-messages'] }),
        queryClient.invalidateQueries({
          queryKey: ['admin-message', variables.id],
        }),
      ]);
    },
  });
  const transitionCustomRequest = useMutation({
    mutationFn: (input: {
      id: string;
      status: Extract<
        CustomRequestStatus,
        'under_review' | 'accepted' | 'declined'
      >;
      message?: string;
    }) =>
      api.transitionAdminCustomRequest(input.id, {
        status: input.status,
        ...(input.message ? { message: input.message } : {}),
      }),
    onSuccess: async (_data, variables) => {
      setCustomResponseMessage('');
      setCustomResponseError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-messages'] }),
        queryClient.invalidateQueries({
          queryKey: ['admin-message', variables.id],
        }),
      ]);
    },
  });
  const createCustomOffer = useMutation({
    mutationFn: (input: { id: string; formData: FormData }) =>
      api.createAdminCustomOffer(input.id, input.formData),
    onSuccess: async (_offer, variables) => {
      setOfferFormError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-messages'] }),
        queryClient.invalidateQueries({
          queryKey: ['admin-message', variables.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ['customer-custom-requests'],
        }),
      ]);
    },
  });
  const [replyValidationError, setReplyValidationError] = useState('');

  const detail = selectedMessage.data;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(search.trim());
    setPage(1);
  }

  function submitCustomOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOfferFormError('');
    const formData = new FormData(event.currentTarget);
    const price = String(formData.get('agreedPrice') ?? '').trim();
    const priceParts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(price);
    if (!priceParts) {
      setOfferFormError('Enter a price with no more than two decimal places.');
      return;
    }
    const agreedPriceMinor =
      Number(priceParts[1]) * 100 +
      Number((priceParts[2] ?? '').padEnd(2, '0'));
    if (!Number.isSafeInteger(agreedPriceMinor) || agreedPriceMinor < 1) {
      setOfferFormError('The agreed total price must be greater than zero.');
      return;
    }
    formData.delete('agreedPrice');
    formData.set('agreedPriceMinor', String(agreedPriceMinor));
    formData.set('currency', 'GBP');
    createCustomOffer.mutate({ id: detail?.id ?? '', formData });
  }

  const hasAdditionalFilters = Boolean(query || status);
  const emptyMessage =
    type === 'custom_3d_request' && !hasAdditionalFilters
      ? 'No custom product requests have been received.'
      : !type && !hasAdditionalFilters
        ? 'No messages yet.'
        : 'No messages match these filters.';

  return (
    <>
      <PageHeader
        title="Messages"
        description="Review customer enquiries and custom product requests."
        actions={
          <Button
            variant="secondary"
            aria-label="Refresh messages"
            onClick={() => {
              void Promise.all([
                messages.refetch(),
                ...(activeId ? [selectedMessage.refetch()] : []),
              ]);
            }}
          >
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <form className="admin-filter-bar" onSubmit={submitSearch}>
        <label>
          Search messages
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Name, email, subject or order number"
          />
        </label>
        <Button type="submit">Search</Button>
        <label>
          Message type
          <select
            className="input"
            value={type}
            onChange={(event) => {
              const selection = MESSAGE_TYPES.find(
                (option) => option.value === event.currentTarget.value,
              );
              if (selection) setType(selection.value);
              setPage(1);
            }}
          >
            {MESSAGE_TYPES.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            className="input"
            value={status}
            onChange={(event) => {
              const selection = MESSAGE_STATUSES.find(
                (option) => option.value === event.currentTarget.value,
              );
              if (selection) setStatus(selection.value);
              setPage(1);
            }}
          >
            {MESSAGE_STATUSES.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      <div className="admin-message-layout">
        <section className="admin-panel" aria-labelledby="message-list-title">
          <div className="admin-panel-heading">
            <div>
              <h2 id="message-list-title">Inbox</h2>
              <p>
                {messages.data
                  ? `${messages.data.pagination.total} messages`
                  : 'Messages'}
              </p>
            </div>
          </div>
          {messages.isError ? (
            <div className="admin-message-state admin-message-state--error">
              <ErrorState title="Messages could not be loaded">
                {messages.error instanceof ApiError
                  ? messages.error.message
                  : messages.error instanceof Error
                    ? messages.error.message
                    : 'The message list is unavailable right now.'}
              </ErrorState>
              <Button
                variant="secondary"
                onClick={() => void messages.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : messages.isPending ? (
            <p className="admin-message-state" role="status">
              Loading messages…
            </p>
          ) : items.length ? (
            <ul className="admin-message-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`admin-message-list-item${item.id === activeId ? ' is-selected' : ''}`}
                    aria-pressed={item.id === activeId}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="admin-message-list-item__content">
                      <strong>{item.subject}</strong>
                      <span>{item.name}</span>
                      <small>
                        {messageTypeLabel(item.type)} ·{' '}
                        {formatDate(item.createdAt)}
                      </small>
                      {item.customer ? (
                        <small>Account: {item.customer.email}</small>
                      ) : item.type === 'custom_3d_request' ? (
                        <small>Historical request — no linked account</small>
                      ) : null}
                    </span>
                    <AdminStatusBadge status={item.status} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-message-state" role="status">
              {emptyMessage}
            </p>
          )}
          {messages.data ? (
            <div className="admin-message-pagination">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <span>
                Page {messages.data.pagination.page} of{' '}
                {Math.max(1, messages.data.pagination.totalPages)}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!messages.data.pagination.hasNextPage}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </section>

        <section
          className="admin-panel admin-message-detail"
          aria-labelledby="message-detail-title"
        >
          {selectedMessage.isPending && activeId ? (
            <p role="status">Loading message details…</p>
          ) : selectedMessage.isError ? (
            <>
              <ErrorState title="Message details could not be loaded">
                {selectedMessage.error instanceof ApiError
                  ? selectedMessage.error.message
                  : selectedMessage.error instanceof Error
                    ? selectedMessage.error.message
                    : 'The selected message is unavailable right now.'}
              </ErrorState>
              <Button
                variant="secondary"
                onClick={() => void selectedMessage.refetch()}
              >
                Try again
              </Button>
            </>
          ) : detail ? (
            <>
              <div className="admin-panel-heading">
                <div>
                  <h2 id="message-detail-title">{detail.subject}</h2>
                  <p>{messageTypeLabel(detail.type)}</p>
                </div>
                <AdminStatusBadge status={detail.status} />
              </div>
              <dl className="admin-message-fields">
                <dt>Customer</dt>
                <dd>{detail.name}</dd>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${detail.email}`}>{detail.email}</a>
                </dd>
                <dt>Received</dt>
                <dd>{formatDate(detail.createdAt)}</dd>
                {detail.orderNumber ? (
                  <>
                    <dt>Order number</dt>
                    <dd>{detail.orderNumber}</dd>
                  </>
                ) : null}
                {detail.type === 'custom_3d_request' ? (
                  <>
                    <dt>Request lifecycle</dt>
                    <dd>
                      {customRequestStatusLabel(detail.customRequestStatus)}
                    </dd>
                    <dt>Linked customer account</dt>
                    <dd>
                      {detail.customer
                        ? `${detail.customer.name} (${detail.customer.email})`
                        : 'No linked account (historical request)'}
                    </dd>
                  </>
                ) : null}
                {detail.type === 'general' ? (
                  <>
                    <dt>Owner email delivery</dt>
                    <dd>{emailDeliveryLabel(detail.emailDeliveryStatus)}</dd>
                  </>
                ) : null}
              </dl>

              {detail.requestDetails ? (
                <section
                  className="admin-message-request-details"
                  aria-labelledby="request-details-title"
                >
                  <h3 id="request-details-title">
                    Custom product request details
                  </h3>
                  {detail.requestDetails.description ? (
                    <div>
                      <strong>Description</strong>
                      <p className="admin-message-body">
                        {detail.requestDetails.description}
                      </p>
                    </div>
                  ) : null}
                  <dl className="admin-message-fields">
                    {detail.requestDetails.productName ? (
                      <>
                        <dt>Product name or request title</dt>
                        <dd>{detail.requestDetails.productName}</dd>
                      </>
                    ) : null}
                    {detail.requestDetails.productType ? (
                      <>
                        <dt>Product type</dt>
                        <dd>
                          {detail.requestDetails.productType}
                          {detail.requestDetails.productType === 'Other' &&
                          detail.requestDetails.otherProductType
                            ? ` — ${detail.requestDetails.otherProductType}`
                            : ''}
                        </dd>
                      </>
                    ) : null}
                    {detail.requestDetails.phone ? (
                      <>
                        <dt>Preferred contact number</dt>
                        <dd>
                          <a href={`tel:${detail.requestDetails.phone}`}>
                            {detail.requestDetails.phone}
                          </a>
                        </dd>
                      </>
                    ) : null}
                    {detail.requestDetails.imagePurpose ? (
                      <>
                        <dt>Image purpose</dt>
                        <dd>
                          {imagePurposeLabel(
                            detail.requestDetails.imagePurpose,
                          )}
                        </dd>
                      </>
                    ) : null}
                    {detail.requestDetails.approximateSize ? (
                      <>
                        <dt>Approximate size</dt>
                        <dd>{detail.requestDetails.approximateSize}</dd>
                      </>
                    ) : null}
                    {detail.requestDetails.preferredColour ? (
                      <>
                        <dt>Preferred colour</dt>
                        <dd>{detail.requestDetails.preferredColour}</dd>
                      </>
                    ) : null}
                    {detail.requestDetails.preferredMaterial ? (
                      <>
                        <dt>Preferred material</dt>
                        <dd>{detail.requestDetails.preferredMaterial}</dd>
                      </>
                    ) : null}
                    {detail.requestDetails.budget ? (
                      <>
                        <dt>Budget range</dt>
                        <dd>{detail.requestDetails.budget}</dd>
                      </>
                    ) : null}
                    {detail.requestDetails.quantity !== undefined ? (
                      <>
                        <dt>Quantity</dt>
                        <dd>{detail.requestDetails.quantity}</dd>
                      </>
                    ) : null}
                    {detail.requestDetails.neededByDate ? (
                      <>
                        <dt>Needed by</dt>
                        <dd>
                          {formatDate(detail.requestDetails.neededByDate)}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </section>
              ) : detail.message ? (
                <div>
                  <h3>Message</h3>
                  <p className="admin-message-body">{detail.message}</p>
                </div>
              ) : null}

              {detail.attachment ? (
                <p className="admin-message-attachment">
                  <strong>
                    Private attachment —{' '}
                    {imagePurposeLabel(
                      detail.requestDetails?.imagePurpose,
                    ).toLowerCase()}
                    :
                  </strong>{' '}
                  <a
                    href={`/api/admin/messages/${encodeURIComponent(detail.id)}/attachment`}
                  >
                    Download {detail.attachment.originalFilename}
                  </a>
                </p>
              ) : null}
              {detail.type === 'custom_3d_request' ? (
                <section
                  className="admin-operation-actions"
                  aria-labelledby="custom-request-lifecycle-heading"
                >
                  <h3 id="custom-request-lifecycle-heading">
                    Custom request lifecycle
                  </h3>
                  <p>
                    Current status:{' '}
                    <strong>
                      {customRequestStatusLabel(detail.customRequestStatus)}
                    </strong>
                  </p>
                  {detail.customRequestResponses.length ? (
                    <ol className="admin-operation-list">
                      {detail.customRequestResponses.map((response, index) => (
                        <li
                          key={response.id ?? `${response.createdAt}-${index}`}
                        >
                          <strong>
                            {response.status === 'accepted'
                              ? 'Accepted'
                              : 'Declined'}
                          </strong>{' '}
                          · {response.authorName ?? 'Staff'} ·{' '}
                          {formatDate(response.createdAt)}
                          <span className="admin-operation-review-body">
                            {response.message}
                          </span>
                          <span>
                            {notificationStatusLabel(
                              response.notificationStatus,
                            )}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>No administrator decision has been recorded.</p>
                  )}
                  {detail.customOffer ? (
                    <section
                      className="admin-operation-actions"
                      aria-labelledby="custom-offer-detail-heading"
                    >
                      <h4 id="custom-offer-detail-heading">
                        Private offer ·{' '}
                        {offerStatusLabel(detail.customOffer.status)}
                      </h4>
                      <dl className="admin-message-fields">
                        <dt>Title</dt>
                        <dd>{detail.customOffer.product.title}</dd>
                        <dt>Description</dt>
                        <dd>{detail.customOffer.product.description}</dd>
                        <dt>Product type</dt>
                        <dd>{detail.customOffer.product.productType}</dd>
                        <dt>Agreed total price</dt>
                        <dd>{formatOfferPrice(detail.customOffer)}</dd>
                        <dt>Agreed quantity</dt>
                        <dd>{detail.customOffer.agreedQuantity}</dd>
                        <dt>Offer expiry</dt>
                        <dd>{formatDate(detail.customOffer.expiresAt)}</dd>
                        <dt>Specifications</dt>
                        <dd>
                          <ul>
                            {detail.customOffer.specifications.map(
                              (specification) => (
                                <li key={specification.label}>
                                  <strong>{specification.label}:</strong>{' '}
                                  {specification.value}
                                </li>
                              ),
                            )}
                          </ul>
                        </dd>
                      </dl>
                      {detail.customOffer.image ? (
                        <figure>
                          <Image
                            src={detail.customOffer.image.url}
                            alt={`Private offer mockup: ${detail.customOffer.image.originalFilename}`}
                            width={detail.customOffer.image.width ?? 800}
                            height={detail.customOffer.image.height ?? 600}
                            unoptimized
                          />
                          <figcaption>
                            Private mockup:{' '}
                            {detail.customOffer.image.originalFilename}
                          </figcaption>
                        </figure>
                      ) : null}
                      <p>
                        The private product is not available in public
                        catalogues, wishlist, cart, or checkout.
                      </p>
                    </section>
                  ) : null}
                  {detail.customRequestStatus === 'submitted' ||
                  detail.customRequestStatus === 'under_review' ? (
                    <>
                      <label>
                        Response to customer
                        <textarea
                          className="input"
                          rows={3}
                          maxLength={2000}
                          value={customResponseMessage}
                          onChange={(event) =>
                            setCustomResponseMessage(event.currentTarget.value)
                          }
                        />
                      </label>
                      <div className="button-row">
                        {detail.customRequestStatus === 'submitted' ? (
                          <Button
                            variant="secondary"
                            disabled={transitionCustomRequest.isPending}
                            onClick={() =>
                              transitionCustomRequest.mutate({
                                id: detail.id,
                                status: 'under_review',
                              })
                            }
                          >
                            Mark under review
                          </Button>
                        ) : null}
                        <Button
                          disabled={transitionCustomRequest.isPending}
                          onClick={() =>
                            transitionCustomRequest.mutate({
                              id: detail.id,
                              status: 'accepted',
                              ...(customResponseMessage.trim()
                                ? { message: customResponseMessage.trim() }
                                : {}),
                            })
                          }
                        >
                          Accept request
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={transitionCustomRequest.isPending}
                          onClick={() => {
                            if (!customResponseMessage.trim()) {
                              setCustomResponseError(
                                'Enter an explanatory message before declining.',
                              );
                              return;
                            }
                            transitionCustomRequest.mutate({
                              id: detail.id,
                              status: 'declined',
                              message: customResponseMessage.trim(),
                            });
                          }}
                        >
                          Decline request
                        </Button>
                      </div>
                      {customResponseError ? (
                        <p className="admin-operation-error" role="alert">
                          {customResponseError}
                        </p>
                      ) : null}
                      {transitionCustomRequest.isError &&
                      transitionCustomRequest.variables?.id === detail.id ? (
                        <p className="admin-operation-error" role="alert">
                          {transitionCustomRequest.error instanceof ApiError
                            ? transitionCustomRequest.error.message
                            : 'The request status could not be updated.'}
                        </p>
                      ) : null}
                      {transitionCustomRequest.isSuccess &&
                      transitionCustomRequest.variables?.id === detail.id ? (
                        <p role="status">
                          Request status saved.{' '}
                          {transitionCustomRequest.data.customRequestResponses.at(
                            -1,
                          )?.notificationStatus === 'failed'
                            ? 'The response email failed; the saved response is visible in the customer account.'
                            : 'The customer response is recorded.'}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {detail.customRequestStatus === 'accepted' &&
                  !detail.customOffer &&
                  detail.customer ? (
                    <form
                      className="admin-operation-actions"
                      onSubmit={submitCustomOffer}
                    >
                      <h4>Create a private custom offer</h4>
                      <p>
                        The offer will be linked to {detail.customer.name} and
                        remain private. Checkout is not enabled.
                      </p>
                      <label>
                        Offer title
                        <input
                          className="input"
                          name="title"
                          required
                          maxLength={200}
                        />
                      </label>
                      <label>
                        Agreed work description
                        <textarea
                          className="input"
                          name="description"
                          required
                          minLength={20}
                          maxLength={5000}
                          rows={4}
                        />
                      </label>
                      <label>
                        Product category
                        <select
                          className="input"
                          name="categoryId"
                          required
                          defaultValue=""
                        >
                          <option value="" disabled>
                            Select a category
                          </option>
                          {availableCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {categories.isError ? (
                        <ErrorState title="Categories could not be loaded">
                          {categories.error instanceof ApiError
                            ? categories.error.message
                            : 'Reload the page and try again.'}
                        </ErrorState>
                      ) : null}
                      <label>
                        Product type
                        <select
                          className="input"
                          name="productType"
                          defaultValue="other"
                          required
                        >
                          {PRIVATE_OFFER_PRODUCT_TYPES.map((productType) => (
                            <option
                              key={productType.value}
                              value={productType.value}
                            >
                              {productType.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Size and dimensions
                        <input
                          className="input"
                          name="size"
                          required
                          maxLength={200}
                        />
                      </label>
                      <label>
                        Colours
                        <input
                          className="input"
                          name="colours"
                          maxLength={300}
                        />
                      </label>
                      <label>
                        Materials
                        <input
                          className="input"
                          name="materials"
                          maxLength={300}
                        />
                      </label>
                      <label>
                        Personalisation details
                        <textarea
                          className="input"
                          name="personalisation"
                          maxLength={500}
                          rows={2}
                        />
                      </label>
                      <label>
                        Additional instructions
                        <textarea
                          className="input"
                          name="additionalInstructions"
                          maxLength={1000}
                          rows={2}
                        />
                      </label>
                      <label>
                        Agreed quantity
                        <input
                          className="input"
                          type="number"
                          name="agreedQuantity"
                          required
                          min={1}
                          max={10000}
                          step={1}
                          defaultValue={detail.requestDetails?.quantity ?? 1}
                        />
                      </label>
                      <label>
                        Agreed total price (GBP)
                        <input
                          className="input"
                          type="number"
                          name="agreedPrice"
                          required
                          min="0.01"
                          max="1000000"
                          step="0.01"
                        />
                      </label>
                      <label>
                        Offer currency
                        <input
                          className="input"
                          name="currency"
                          value="GBP"
                          readOnly
                        />
                      </label>
                      <label>
                        Offer expiry
                        <input
                          className="input"
                          type="datetime-local"
                          name="expiresAt"
                          required
                          min={new Date().toISOString().slice(0, 16)}
                        />
                      </label>
                      <label>
                        Private product image or mockup
                        <input
                          className="input"
                          type="file"
                          name="file"
                          accept="image/jpeg,image/png,image/webp"
                          required
                        />
                      </label>
                      {offerFormError ? (
                        <p className="admin-operation-error" role="alert">
                          {offerFormError}
                        </p>
                      ) : null}
                      {createCustomOffer.isError &&
                      createCustomOffer.variables?.id === detail.id ? (
                        <p className="admin-operation-error" role="alert">
                          {createCustomOffer.error instanceof ApiError
                            ? createCustomOffer.error.message
                            : 'The private offer could not be created.'}
                        </p>
                      ) : null}
                      <Button
                        type="submit"
                        disabled={
                          createCustomOffer.isPending ||
                          categories.isPending ||
                          availableCategories.length === 0
                        }
                      >
                        {createCustomOffer.isPending
                          ? 'Creating private offer…'
                          : 'Create private offer'}
                      </Button>
                    </form>
                  ) : null}
                  {detail.customRequestStatus === 'accepted' &&
                  !detail.customer ? (
                    <p>
                      This historical request has no linked customer account, so
                      a private offer cannot be created.
                    </p>
                  ) : null}
                </section>
              ) : null}
              {detail.replies.length ? (
                <section
                  className="admin-operation-actions"
                  aria-labelledby="message-replies-heading"
                >
                  <h3 id="message-replies-heading">Reply history</h3>
                  <ol className="admin-operation-list">
                    {detail.replies.map((item, index) => (
                      <li key={item.id ?? `${item.createdAt}-${index}`}>
                        <strong>{item.authorName ?? 'Staff'}</strong> ·{' '}
                        {formatDate(item.createdAt)}
                        <span className="admin-operation-review-body">
                          {item.body}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
              <form
                className="admin-operation-actions"
                key={`message-reply-${detail.id}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const body = String(data.get('replyBody') ?? '').trim();
                  const priceText = String(
                    data.get('quotedPrice') ?? '',
                  ).trim();
                  const note = String(data.get('quoteNote') ?? '').trim();
                  let quotedPriceMinor: number | undefined;
                  if (priceText) {
                    if (!/^\d+(?:\.\d{1,2})?$/.test(priceText)) {
                      setReplyValidationError(
                        'Enter a non-negative quote with up to two decimal places.',
                      );
                      return;
                    }
                    const [whole, fraction = ''] = priceText.split('.');
                    const parsed =
                      Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
                    if (!Number.isSafeInteger(parsed)) {
                      setReplyValidationError('The quote amount is too large.');
                      return;
                    }
                    quotedPriceMinor = parsed;
                  }
                  setReplyValidationError('');
                  if (body) {
                    reply.mutate({
                      id: detail.id,
                      body,
                      ...(quotedPriceMinor !== undefined
                        ? { quotedPriceMinor }
                        : {}),
                      ...(note ? { note } : {}),
                    });
                  }
                }}
              >
                <h3>Reply to customer</h3>
                <label>
                  Reply
                  <textarea
                    className="input"
                    name="replyBody"
                    required
                    rows={5}
                    maxLength={10000}
                  />
                </label>
                <label>
                  Quote amount in GBP (optional)
                  <input
                    className="input"
                    name="quotedPrice"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </label>
                <label>
                  Quote note (optional)
                  <input className="input" name="quoteNote" maxLength={2000} />
                </label>
                <p className="admin-operation-note">
                  Replies use the configured email service. If delivery is
                  unavailable, the API reports an error.
                </p>
                <Button type="submit" disabled={reply.isPending}>
                  {reply.isPending ? 'Sending…' : 'Send reply'}
                </Button>
                {replyValidationError ? (
                  <p className="admin-operation-error" role="alert">
                    {replyValidationError}
                  </p>
                ) : null}
                {reply.isError && reply.variables?.id === detail.id ? (
                  <p className="admin-operation-error" role="alert">
                    {reply.error instanceof ApiError
                      ? reply.error.message
                      : 'The reply could not be sent.'}
                  </p>
                ) : null}
                {reply.isSuccess && reply.variables?.id === detail.id ? (
                  <p role="status">Reply sent.</p>
                ) : null}
              </form>
              <section
                className="admin-operation-actions"
                aria-labelledby="message-status-heading"
              >
                <h3 id="message-status-heading">Enquiry status</h3>
                <div className="button-row">
                  {(['new', 'in_progress', 'resolved'] as const).map(
                    (nextStatus) => (
                      <Button
                        key={nextStatus}
                        variant={
                          detail.status === nextStatus ? 'primary' : 'secondary'
                        }
                        disabled={
                          detail.status === nextStatus || updateStatus.isPending
                        }
                        onClick={() =>
                          updateStatus.mutate({
                            id: detail.id,
                            status: nextStatus,
                          })
                        }
                      >
                        {nextStatus === 'in_progress'
                          ? 'In progress'
                          : nextStatus.charAt(0).toUpperCase() +
                            nextStatus.slice(1)}
                      </Button>
                    ),
                  )}
                </div>
                {updateStatus.isError &&
                updateStatus.variables?.id === detail.id ? (
                  <p className="admin-operation-error" role="alert">
                    {updateStatus.error instanceof ApiError
                      ? updateStatus.error.message
                      : 'The message status could not be updated.'}
                  </p>
                ) : null}
                {updateStatus.isSuccess &&
                updateStatus.variables?.id === detail.id ? (
                  <p role="status">Message status updated.</p>
                ) : null}
              </section>
            </>
          ) : messages.isSuccess && !items.length ? (
            <p role="status">
              No message details are available because the inbox has no matching
              messages.
            </p>
          ) : (
            <p role="status">Select a message to view its details.</p>
          )}
        </section>
      </div>
    </>
  );
}

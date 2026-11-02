'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button, ErrorState } from '@/components/ui';
import { api, ApiError } from '@/lib/api/client';
import type { CustomOfferSummary, CustomRequestStatus } from '@/lib/api/types';
import { formatDate } from '@/lib/utils/formatDate';

const STATUS_LABELS: Record<CustomRequestStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  accepted: 'Accepted',
  declined: 'Declined',
  offer_created: 'Offer created',
  completed: 'Completed',
};

const OFFER_STATUS_LABELS: Record<CustomOfferSummary['status'], string> = {
  available: 'Created — not purchasable yet',
  reserved: 'Reserved',
  purchased: 'Purchased',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

function offerPrice(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(minor / 100);
}

export function CustomRequestHistory() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [selectedId, setSelectedId] = useState('');
  const requests = useQuery({
    queryKey: ['customer-custom-requests'],
    queryFn: api.customerCustomRequests,
    enabled: Boolean(user && user.role === 'customer'),
    retry: false,
  });
  const items = requests.data ?? [];
  const activeId = items.some((item) => item.id === selectedId)
    ? selectedId
    : (items[0]?.id ?? '');
  const detail = useQuery({
    queryKey: ['customer-custom-request', activeId],
    queryFn: () => api.customerCustomRequest(activeId),
    enabled: Boolean(activeId && user?.role === 'customer'),
    retry: false,
  });

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'customer')) {
      router.replace('/login?next=%2Faccount%2Fcustom-requests');
    }
  }, [authLoading, router, user]);

  if (authLoading || !user || user.role !== 'customer') {
    return (
      <div className="commerce-page">
        <p className="commerce-card" role="status">
          {authLoading ? 'Checking your account…' : 'Redirecting to sign in…'}
        </p>
      </div>
    );
  }

  return (
    <div className="commerce-page">
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">My custom requests</span>
      </nav>
      <div className="commerce-page__heading">
        <div>
          <h1>My custom requests</h1>
          <p>Review your request details, status, and studio responses.</p>
        </div>
        <Button onClick={() => router.push('/custom-3d-request')}>
          Send a custom request
        </Button>
      </div>

      {requests.isPending ? (
        <p role="status">Loading your custom requests…</p>
      ) : requests.isError ? (
        <div className="commerce-state" role="alert">
          <ErrorState title="Your custom requests could not be loaded">
            {requests.error instanceof ApiError
              ? requests.error.message
              : 'Please try again in a moment.'}
          </ErrorState>
          <Button variant="secondary" onClick={() => void requests.refetch()}>
            Retry
          </Button>
        </div>
      ) : items.length ? (
        <div className="admin-message-layout">
          <section
            className="admin-panel"
            aria-labelledby="custom-request-list"
          >
            <h2 id="custom-request-list">Submitted requests</h2>
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
                      <strong>{item.productName ?? item.subject}</strong>
                      <span>
                        {item.productType ?? 'Custom product request'}
                      </span>
                      <small>{formatDate(item.createdAt)}</small>
                    </span>
                    <span>{STATUS_LABELS[item.customRequestStatus]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section
            className="admin-panel admin-message-detail"
            aria-labelledby="custom-request-detail"
          >
            {detail.isPending ? (
              <p role="status">Loading request details…</p>
            ) : detail.isError ? (
              <div role="alert">
                <ErrorState title="Request details could not be loaded">
                  {detail.error instanceof ApiError
                    ? detail.error.message
                    : 'Please try again in a moment.'}
                </ErrorState>
                <Button
                  variant="secondary"
                  onClick={() => void detail.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : detail.data ? (
              <>
                <div className="admin-panel-heading">
                  <div>
                    <h2 id="custom-request-detail">
                      {detail.data.requestDetails?.productName ??
                        detail.data.subject}
                    </h2>
                    <p>
                      Status:{' '}
                      <strong>
                        {STATUS_LABELS[detail.data.customRequestStatus]}
                      </strong>
                    </p>
                  </div>
                </div>
                <p className="admin-message-body">{detail.data.message}</p>
                {detail.data.requestDetails ? (
                  <dl className="admin-message-fields">
                    {detail.data.requestDetails.productType ? (
                      <>
                        <dt>Product type</dt>
                        <dd>
                          {detail.data.requestDetails.productType}
                          {detail.data.requestDetails.otherProductType
                            ? ` — ${detail.data.requestDetails.otherProductType}`
                            : ''}
                        </dd>
                      </>
                    ) : null}
                    {detail.data.requestDetails.phone ? (
                      <>
                        <dt>Preferred contact number</dt>
                        <dd>{detail.data.requestDetails.phone}</dd>
                      </>
                    ) : null}
                    {detail.data.requestDetails.imagePurpose ? (
                      <>
                        <dt>Image purpose</dt>
                        <dd>{detail.data.requestDetails.imagePurpose}</dd>
                      </>
                    ) : null}
                    {detail.data.requestDetails.approximateSize ? (
                      <>
                        <dt>Approximate size</dt>
                        <dd>{detail.data.requestDetails.approximateSize}</dd>
                      </>
                    ) : null}
                    {detail.data.requestDetails.preferredColour ? (
                      <>
                        <dt>Preferred colour</dt>
                        <dd>{detail.data.requestDetails.preferredColour}</dd>
                      </>
                    ) : null}
                    {detail.data.requestDetails.preferredMaterial ? (
                      <>
                        <dt>Preferred material</dt>
                        <dd>{detail.data.requestDetails.preferredMaterial}</dd>
                      </>
                    ) : null}
                    {detail.data.requestDetails.budget ? (
                      <>
                        <dt>Budget</dt>
                        <dd>{detail.data.requestDetails.budget}</dd>
                      </>
                    ) : null}
                    {detail.data.requestDetails.quantity ? (
                      <>
                        <dt>Quantity</dt>
                        <dd>{detail.data.requestDetails.quantity}</dd>
                      </>
                    ) : null}
                    {detail.data.requestDetails.neededByDate ? (
                      <>
                        <dt>Preferred deadline</dt>
                        <dd>
                          {formatDate(detail.data.requestDetails.neededByDate)}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                ) : null}
                {detail.data.customOffer ? (
                  <section
                    className="admin-operation-actions"
                    aria-labelledby="customer-private-offer-heading"
                  >
                    <h3 id="customer-private-offer-heading">
                      Your private custom offer
                    </h3>
                    <p>
                      Status:{' '}
                      <strong>
                        {OFFER_STATUS_LABELS[detail.data.customOffer.status]}
                      </strong>
                    </p>
                    <h4>{detail.data.customOffer.product.title}</h4>
                    <p>{detail.data.customOffer.product.description}</p>
                    <dl className="admin-message-fields">
                      <dt>Product type</dt>
                      <dd>{detail.data.customOffer.product.productType}</dd>
                      <dt>Agreed total price</dt>
                      <dd>
                        {offerPrice(
                          detail.data.customOffer.agreedPriceMinor,
                          detail.data.customOffer.currency,
                        )}
                      </dd>
                      <dt>Agreed quantity</dt>
                      <dd>{detail.data.customOffer.agreedQuantity}</dd>
                      <dt>Offer expiry</dt>
                      <dd>{formatDate(detail.data.customOffer.expiresAt)}</dd>
                      <dt>Specifications</dt>
                      <dd>
                        <ul>
                          {detail.data.customOffer.specifications.map(
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
                    {detail.data.customOffer.image ? (
                      <figure>
                        <Image
                          src={detail.data.customOffer.image.url}
                          alt={`Private offer mockup: ${detail.data.customOffer.image.originalFilename}`}
                          width={detail.data.customOffer.image.width ?? 800}
                          height={detail.data.customOffer.image.height ?? 600}
                          unoptimized
                        />
                        <figcaption>
                          Private offer mockup:{' '}
                          {detail.data.customOffer.image.originalFilename}
                        </figcaption>
                      </figure>
                    ) : null}
                    <p>
                      This offer is private to your account. Checkout is not
                      available yet.
                    </p>
                  </section>
                ) : null}
                {detail.data.attachment ? (
                  <figure>
                    <Image
                      src={detail.data.attachment.url}
                      alt={`Reference image: ${detail.data.attachment.originalFilename}`}
                      width={detail.data.attachment.width ?? 800}
                      height={detail.data.attachment.height ?? 600}
                      unoptimized
                    />
                    <figcaption>
                      Your private reference image:{' '}
                      {detail.data.attachment.originalFilename}
                    </figcaption>
                  </figure>
                ) : null}
                <section aria-labelledby="custom-request-responses">
                  <h3 id="custom-request-responses">Studio responses</h3>
                  {detail.data.responses.length ? (
                    <ol className="admin-operation-list">
                      {detail.data.responses.map((response, index) => (
                        <li
                          key={response.id ?? `${response.createdAt}-${index}`}
                        >
                          <strong>
                            {response.status === 'accepted'
                              ? 'Request accepted'
                              : 'Request declined'}
                          </strong>{' '}
                          · {formatDate(response.createdAt)}
                          <span className="admin-operation-review-body">
                            {response.message}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>
                      Your request is being reviewed. We will post any update
                      here and contact you by email.
                    </p>
                  )}
                  {detail.data.customRequestStatus === 'accepted' ? (
                    <p>
                      Your request was accepted. A custom offer has not yet been
                      created.
                    </p>
                  ) : null}
                </section>
                <p>Submitted {formatDate(detail.data.createdAt)}</p>
              </>
            ) : null}
          </section>
        </div>
      ) : (
        <section className="commerce-card commerce-empty">
          <h2>No custom requests yet</h2>
          <p>Requests you submit will appear here with their status.</p>
          <Button onClick={() => router.push('/custom-3d-request')}>
            Send a custom request
          </Button>
        </section>
      )}
    </div>
  );
}

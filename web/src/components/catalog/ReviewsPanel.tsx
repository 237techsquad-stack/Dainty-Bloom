'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Badge, Button, Input, Textarea, useToast } from '@/components/ui';
import { useAuth } from '@/components/providers/AuthProvider';
import { api } from '@/lib/api/client';
import { StarRating } from './CatalogComponents';

const REASON_TEXT: Record<string, string> = {
  already_reviewed: 'You have already reviewed this product.',
  verified_purchase_required: 'A completed or shipped purchase is required to review this product.',
};

export function ReviewsPanel({ slug }: { slug: string }) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'newest' | 'highest' | 'lowest'>('newest');
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const reviews = useQuery({
    queryKey: ['product-reviews', slug, page, sort],
    queryFn: () => api.reviews(slug, { page, sort, limit: 10 }),
  });
  const eligibility = useQuery({
    queryKey: ['product-review-eligibility', slug],
    queryFn: () => api.reviewEligibility(slug),
    enabled: user?.role === 'customer',
    retry: false,
  });

  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (rating === 0) {
      setError('Choose a star rating.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createReview(slug, { rating, title: title.trim(), body: body.trim() });
      setTitle('');
      setBody('');
      setRating(0);
      toast('Thanks, your review will appear once it has been checked.', 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['product-reviews', slug] }),
        queryClient.invalidateQueries({ queryKey: ['product-review-eligibility', slug] }),
      ]);
    } catch {
      setError('Your review could not be submitted. Please check the details and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const summary = reviews.data?.summary;
  return (
    <section className="reviews-panel" aria-labelledby={titleId}>
      <h2 id={titleId}>Customer reviews</h2>
      {reviews.isPending ? <p aria-live="polite">Loading reviews…</p> : null}
      {reviews.isError ? <p className="catalog-inline-error" role="alert">Reviews could not be loaded. Refresh to try again.</p> : null}
      {summary ? (
        <div className="reviews-summary">
          <div className="reviews-summary__score">
            <strong>{summary.average?.toFixed(1) ?? '—'}</strong>
            <StarRating rating={summary.average} count={summary.count} />
          </div>
          <div className="reviews-distribution" aria-label="Rating distribution">
            {[5, 4, 3, 2, 1].map((stars) => {
              const count = summary.distribution[String(stars)] ?? 0;
              return (
                <div className="reviews-distribution__row" key={stars}>
                  <span>{stars} stars</span>
                  <span className="reviews-distribution__track"><span style={{ width: `${summary.count ? (count / summary.count) * 100 : 0}%` }} /></span>
                  <span>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="reviews-toolbar">
        <span>{reviews.data?.pagination.total ?? 0} reviews</span>
        <label>Sort by <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }}>
          <option value="newest">Newest</option><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option>
        </select></label>
      </div>
      {!reviews.isPending && reviews.data?.items.length === 0 ? <p className="honest-empty">There are no approved reviews yet.</p> : null}
      <div className="review-list">
        {reviews.data?.items.map((review) => (
          <article className="review-item" key={review.id}>
            <div className="review-item__heading"><StarRating rating={review.rating} count={0} /><time dateTime={review.date}>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(review.date))}</time></div>
            <h3>{review.title}</h3><p>{review.body}</p>
            <div className="review-item__byline"><span>{review.reviewerName}</span>{review.verifiedPurchase ? <Badge tone="success">Verified purchase</Badge> : null}</div>
          </article>
        ))}
      </div>
      {reviews.data && reviews.data.pagination.totalPages > 1 ? (
        <div className="reviews-pagination">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
          <span>Page {page} of {reviews.data.pagination.totalPages}</span>
          <Button variant="secondary" disabled={page >= reviews.data.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
        </div>
      ) : null}
      <div className="write-review">
        <h3>Write a review</h3>
        {!user ? <p><Link href={`/login?next=${encodeURIComponent(`/product/${slug}#reviews`)}`}>Sign in</Link> to check whether you can review this product.</p> : null}
        {user && user.role !== 'customer' ? <p>Only customer accounts can review products.</p> : null}
        {user?.role === 'customer' && eligibility.data?.canReview ? (
          <form onSubmit={(event) => void submitReview(event)}>
            <StarRating input value={rating} onChange={setRating} />
            <Input label="Review title" value={title} maxLength={160} required minLength={2} onChange={(event) => setTitle(event.target.value)} />
            <Textarea label="Your review" value={body} required minLength={10} maxLength={5000} onChange={(event) => setBody(event.target.value)} />
            {error ? <p className="catalog-inline-error" role="alert">{error}</p> : null}
            <Button type="submit" loading={submitting}>Submit review</Button>
          </form>
        ) : null}
        {user?.role === 'customer' && eligibility.data && !eligibility.data.canReview ? (
          <p>{REASON_TEXT[eligibility.data.reason ?? ''] ?? 'You are not currently eligible to review this product.'}</p>
        ) : null}
        {user?.role === 'customer' && eligibility.isError ? <p>Review eligibility could not be checked right now.</p> : null}
      </div>
    </section>
  );
}

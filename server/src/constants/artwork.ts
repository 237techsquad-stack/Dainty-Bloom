export const ARTWORK_REVIEW_STATUS = [
  'pending',
  'approved',
  'replacement_requested',
] as const;
export type ArtworkReviewStatus = (typeof ARTWORK_REVIEW_STATUS)[number];

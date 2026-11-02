export const REVIEW_MODERATION_STATES = [
  'pending',
  'approved',
  'rejected',
] as const;
export type ReviewModerationState = (typeof REVIEW_MODERATION_STATES)[number];
export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;

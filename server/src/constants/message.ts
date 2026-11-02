export const MESSAGE_STATUSES = [
  'new',
  'in_progress',
  'quoted',
  'resolved',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const CUSTOM_REQUEST_STATUSES = [
  'submitted',
  'under_review',
  'accepted',
  'declined',
  'offer_created',
  'completed',
] as const;
export type CustomRequestStatus = (typeof CUSTOM_REQUEST_STATUSES)[number];

export const CUSTOM_REQUEST_RESPONSE_STATUSES = [
  'accepted',
  'declined',
] as const;
export type CustomRequestResponseStatus =
  (typeof CUSTOM_REQUEST_RESPONSE_STATUSES)[number];

export const CUSTOM_REQUEST_NOTIFICATION_STATUSES = [
  'pending',
  'sent',
  'failed',
] as const;
export type CustomRequestNotificationStatus =
  (typeof CUSTOM_REQUEST_NOTIFICATION_STATUSES)[number];

export const MESSAGE_TYPES = [
  'general',
  'custom_3d_request',
  'bulk_quote',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const CUSTOM_REQUEST_IMAGE_PURPOSES = [
  'no_image',
  'my_design',
  'reference',
  'example',
] as const;
export type CustomRequestImagePurpose =
  (typeof CUSTOM_REQUEST_IMAGE_PURPOSES)[number];

export const MESSAGE_EMAIL_DELIVERY_STATUSES = [
  'not_tracked',
  'not_required',
  'pending',
  'sent',
  'failed',
] as const;
export type MessageEmailDeliveryStatus =
  (typeof MESSAGE_EMAIL_DELIVERY_STATUSES)[number];

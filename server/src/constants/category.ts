export const CATEGORY_FORM_PROFILES = [
  'apparel',
  'drinkware',
  'canvas_art',
  'three_d_printed',
  'bags',
  'general',
] as const;

export type CategoryFormProfile = (typeof CATEGORY_FORM_PROFILES)[number];

export const DEFAULT_CATEGORY_FORM_PROFILE: CategoryFormProfile = 'general';

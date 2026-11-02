export const PRODUCT_STATUS = [
  'draft',
  'active',
  'archived',
  'out_of_stock',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[number];

export const PRODUCT_THEMES = [
  'christmas',
  'halloween',
  'autumn',
  'kids',
  'anime',
] as const;
export type ProductTheme = (typeof PRODUCT_THEMES)[number];

export const PRODUCT_TYPE = [
  'tshirt',
  'mug',
  'canvas_paint_yourself',
  'canvas_custom_print',
  'three_d_printed',
  'other',
] as const;
export const LEGACY_PRODUCT_TYPE = [
  'hoodie',
  'canvas',
  'poster',
  'tote_bag',
  'banner',
  'signage',
  'accessory',
] as const;
export const ALL_PRODUCT_TYPES = [
  ...PRODUCT_TYPE,
  ...LEGACY_PRODUCT_TYPE,
] as const;
export type ProductType =
  (typeof PRODUCT_TYPE)[number] | (typeof LEGACY_PRODUCT_TYPE)[number];

export const PRINT_TECHNIQUE = [
  'sublimation',
  'dtg',
  'screen_printing',
  'three_d_printing',
  'vinyl',
  'canvas_print',
  'other',
] as const;
export type PrintTechnique = (typeof PRINT_TECHNIQUE)[number];

export const PRODUCT_OPTION_KEYS = [
  'material',
  'technique',
  'color',
  'colour',
  'size',
  'capacity',
  'printArea',
  'frame',
  'edgeStyle',
  'finish',
] as const;
export type ProductOptionKey = (typeof PRODUCT_OPTION_KEYS)[number];

export const PRODUCT_TYPE_OPTION_KEYS: Record<
  ProductType,
  readonly ProductOptionKey[]
> = {
  tshirt: ['material', 'colour', 'color', 'size', 'printArea'],
  mug: ['size', 'capacity', 'colour', 'color', 'printArea'],
  canvas_paint_yourself: ['size', 'frame', 'edgeStyle'],
  canvas_custom_print: ['size', 'frame', 'edgeStyle', 'finish'],
  three_d_printed: ['material', 'colour', 'color', 'size', 'finish'],
  hoodie: ['material', 'technique', 'color', 'size', 'printArea'],
  canvas: ['technique', 'color', 'size', 'printArea'],
  poster: ['technique', 'color', 'size', 'printArea'],
  tote_bag: ['material', 'technique', 'color', 'size', 'printArea'],
  banner: ['material', 'technique', 'size', 'printArea'],
  signage: ['material', 'technique', 'size', 'printArea'],
  accessory: ['material', 'technique', 'color', 'size'],
  other: ['material', 'technique', 'color', 'size', 'printArea'],
};

export const PRODUCT_MEDIA_VIEWS = [
  'front',
  'back',
  'detail',
  'size_reference',
  'sample',
  'side',
  'lifestyle',
] as const;
export type ProductMediaView = (typeof PRODUCT_MEDIA_VIEWS)[number];

export const PRODUCT_LIGHTING_STATES = ['on', 'off'] as const;
export type ProductLightingState = (typeof PRODUCT_LIGHTING_STATES)[number];

export const LIGHTING_GALLERY_CATEGORY_SLUG = 'lamps-and-lighting';

export const PRODUCT_MEDIA_MAX_IMAGES = 10;

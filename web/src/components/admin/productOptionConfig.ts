export const PRODUCT_TYPE_OPTION_KEYS = {
  // Keep these product-type option keys in sync with server/src/constants/product.ts.
  tshirt: ['material', 'colour', 'color', 'size', 'printArea'],
  mug: ['size', 'capacity', 'colour', 'color', 'printArea'],
  canvas_paint_yourself: ['size', 'frame', 'edgeStyle'],
  canvas_custom_print: ['size', 'frame', 'edgeStyle', 'finish'],
  three_d_printed: ['material', 'colour', 'color', 'size', 'finish'],
  other: ['material', 'technique', 'color', 'size', 'printArea'],
} as const;

export const PRODUCT_TYPE_OPTIONS = [
  { value: 'tshirt', label: 'T-Shirt' },
  { value: 'mug', label: 'Mug' },
  { value: 'canvas_paint_yourself', label: 'Paint-It-Yourself Canvas' },
  { value: 'canvas_custom_print', label: 'Custom Canvas Print' },
  { value: 'three_d_printed', label: '3D Printed' },
  { value: 'other', label: 'Other' },
] as const;

export const PRINT_TECHNIQUES = [
  'sublimation',
  'dtg',
  'screen_printing',
  'three_d_printing',
  'vinyl',
  'canvas_print',
  'other',
] as const;

export const OPTION_LABELS: Record<string, string> = {
  material: 'Material',
  technique: 'Technique',
  color: 'Color',
  colour: 'Colour',
  size: 'Size',
  capacity: 'Capacity',
  printArea: 'Print area',
  frame: 'Frame',
  edgeStyle: 'Edge style',
  finish: 'Finish',
};

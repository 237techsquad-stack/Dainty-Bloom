import { describe, expect, it } from 'vitest';
import { getProductImageAlt } from './productImageAlt';

describe('getProductImageAlt', () => {
  it('preserves useful image descriptions', () => {
    expect(
      getProductImageAlt('Floral Mug', 'Mug with a blue floral print'),
    ).toBe('Mug with a blue floral print');
  });

  it('uses the product title when image alt text is missing or generic', () => {
    expect(getProductImageAlt('Floral Mug', '  ')).toBe(
      'Floral Mug product photo',
    );
    expect(getProductImageAlt('Floral Mug', 'Product image')).toBe(
      'Floral Mug product photo',
    );
  });
});

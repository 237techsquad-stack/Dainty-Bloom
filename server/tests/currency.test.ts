import { describe, expect, it } from 'vitest';

import { convertUsdMinorToGbpMinor, formatMoney } from '../src/utils/currency';
import { updateSettingsSchema } from '../src/validators/settings.validators';

describe('currency utilities', () => {
  it.each([
    [1000, 753],
    [5000, 3763],
    [10000, 7526],
    [1, 1],
    [0, 0],
    [-1000, -753],
  ])('converts %i USD minor units to %i GBP minor units', (source, target) => {
    expect(convertUsdMinorToGbpMinor(source)).toBe(target);
  });

  it('rejects invalid monetary integers', () => {
    expect(() => convertUsdMinorToGbpMinor(1.5)).toThrow(
      'USD minor-unit amounts must be safe integers',
    );
    expect(() =>
      convertUsdMinorToGbpMinor(Number.MAX_SAFE_INTEGER + 1),
    ).toThrow('USD minor-unit amounts must be safe integers');
  });

  it('formats in the currency stored with the amount', () => {
    expect(formatMoney(1250, 'USD')).toContain('$12.50');
    expect(formatMoney(1250, 'GBP')).toContain('£12.50');
  });

  it('does not allow changing the store currency through settings updates', () => {
    expect(
      updateSettingsSchema.safeParse({
        params: {},
        query: {},
        body: { currency: 'GBP' },
      }).success,
    ).toBe(false);
  });
});

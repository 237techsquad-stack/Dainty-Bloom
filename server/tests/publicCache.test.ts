import { describe, expect, it } from 'vitest';

import {
  getCachedPublicValue,
  invalidatePublicCache,
} from '../src/utils/publicCache';

describe('public response cache', () => {
  it('shares cached public values and invalidates matching keys', async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { version: loads };
    };

    await expect(getCachedPublicValue('settings:test', load)).resolves.toEqual({
      version: 1,
    });
    await expect(getCachedPublicValue('settings:test', load)).resolves.toEqual({
      version: 1,
    });
    expect(loads).toBe(1);

    invalidatePublicCache('settings:');
    await expect(getCachedPublicValue('settings:test', load)).resolves.toEqual({
      version: 2,
    });
  });
});

import type { FilterQuery } from 'mongoose';

import type { IProduct } from '../models/Product';

export function publicProductFilter(): FilterQuery<IProduct> {
  return {
    $or: [{ visibility: 'public' }, { visibility: { $exists: false } }],
  };
}

export function isPublicProduct(
  product: Pick<IProduct, 'visibility'>,
): boolean {
  return product.visibility === undefined || product.visibility === 'public';
}

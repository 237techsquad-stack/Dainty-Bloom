import type { IProduct, IProductOptionGroup } from '../models/Product';
import { AppError } from '../utils/AppError';
import {
  PRODUCT_TYPE_OPTION_KEYS,
  type ProductOptionKey,
  type ProductType,
} from '../constants/product';

export interface SelectedProductOption {
  key: string;
  value: string;
}

export interface PriceBreakdown {
  basePriceMinor: number;
  optionModifiersMinor: number;
  quantityTierDiscountMinor: number;
  appliedQuantityTier?: { minQty: number; unitPriceMinor: number };
}

export interface UnitPriceCalculation {
  unitPriceMinor: number;
  lineTotalMinor: number;
  breakdown: PriceBreakdown;
}

export function calculateUnitPrice(
  product: Pick<
    IProduct,
    | 'basePriceMinor'
    | 'optionGroups'
    | 'quantityPricing'
    | 'minOrderQuantity'
    | 'maxOrderQuantity'
    | 'stock'
  >,
  selectedOptions: readonly SelectedProductOption[],
  quantity: number,
): UnitPriceCalculation {
  validateQuantity(product, quantity);

  const selectedByKey = new Map<string, string>();
  for (const option of selectedOptions) {
    if (selectedByKey.has(option.key)) {
      throw invalidSelection(
        `Option "${option.key}" was selected more than once`,
      );
    }
    selectedByKey.set(option.key, option.value);
  }

  const knownKeys = new Set(product.optionGroups.map(({ key }) => key));
  for (const key of selectedByKey.keys()) {
    if (!knownKeys.has(key)) {
      throw invalidSelection(`Unknown option "${key}"`);
    }
  }

  let optionModifiersMinor = 0;
  for (const group of product.optionGroups) {
    const selectedValue = selectedByKey.get(group.key);
    if (!selectedValue) {
      if (group.required) {
        throw invalidSelection(`Option "${group.key}" is required`);
      }
      continue;
    }

    const matchingValue = group.values.find(
      (value) => value.value === selectedValue && value.isAvailable,
    );
    if (!matchingValue) {
      throw invalidSelection(`Option "${group.key}" is invalid or unavailable`);
    }
    optionModifiersMinor += matchingValue.priceModifierMinor;
  }

  const baseWithOptionsMinor = product.basePriceMinor + optionModifiersMinor;
  if (!Number.isSafeInteger(baseWithOptionsMinor) || baseWithOptionsMinor < 0) {
    throw new AppError(
      'Calculated price is invalid',
      400,
      'INVALID_PRODUCT_PRICE',
    );
  }

  const tier = [...product.quantityPricing]
    .filter((candidate) => candidate.minQty <= quantity)
    .sort((left, right) => right.minQty - left.minQty)[0];
  const unitPriceMinor = tier?.unitPriceMinor ?? baseWithOptionsMinor;
  const lineTotalMinor = unitPriceMinor * quantity;
  if (!Number.isSafeInteger(lineTotalMinor)) {
    throw new AppError(
      'Calculated line total is invalid',
      400,
      'INVALID_PRODUCT_PRICE',
    );
  }

  return {
    unitPriceMinor,
    lineTotalMinor,
    breakdown: {
      basePriceMinor: product.basePriceMinor,
      optionModifiersMinor,
      quantityTierDiscountMinor:
        tier === undefined
          ? 0
          : Math.max(0, baseWithOptionsMinor - tier.unitPriceMinor),
      appliedQuantityTier: tier
        ? { minQty: tier.minQty, unitPriceMinor: tier.unitPriceMinor }
        : undefined,
    },
  };
}

export function validateQuantity(
  product: Pick<IProduct, 'minOrderQuantity' | 'maxOrderQuantity' | 'stock'>,
  quantity: number,
): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AppError(
      'Quantity must be a positive integer',
      400,
      'INVALID_QUANTITY',
    );
  }
  if (quantity < product.minOrderQuantity) {
    throw new AppError(
      `Minimum order quantity is ${product.minOrderQuantity}`,
      400,
      'MINIMUM_QUANTITY_NOT_MET',
    );
  }
  if (
    product.maxOrderQuantity !== undefined &&
    quantity > product.maxOrderQuantity
  ) {
    throw new AppError(
      `Maximum order quantity is ${product.maxOrderQuantity}`,
      400,
      'MAXIMUM_QUANTITY_EXCEEDED',
    );
  }
  if (
    product.stock.trackInventory &&
    quantity > product.stock.quantity &&
    !product.stock.allowBackorder &&
    !product.stock.reserveBlanksForMadeToOrder
  ) {
    throw new AppError(
      'Requested quantity is unavailable',
      409,
      'INSUFFICIENT_STOCK',
    );
  }
}

export function lowestPossibleUnitPrice(
  product: Pick<
    IProduct,
    'basePriceMinor' | 'optionGroups' | 'quantityPricing'
  >,
): number {
  const lowestModifier = product.optionGroups.reduce((total, group) => {
    if (!group.values.length) return total;
    const groupMinimum = group.values
      .filter((value) => value.isAvailable)
      .reduce<number | undefined>(
        (minimum, value) =>
          minimum === undefined
            ? value.priceModifierMinor
            : Math.min(minimum, value.priceModifierMinor),
        undefined,
      );
    return (
      total +
      (group.required ? (groupMinimum ?? 0) : Math.min(0, groupMinimum ?? 0))
    );
  }, 0);
  const configuredPrice = product.basePriceMinor + lowestModifier;
  const tiers = product.quantityPricing.map(
    ({ unitPriceMinor }) => unitPriceMinor,
  );
  return Math.max(
    0,
    tiers.length ? Math.min(configuredPrice, ...tiers) : configuredPrice,
  );
}

export function validOptionGroupsForProductType(
  productType: string,
  optionGroups: readonly Pick<IProductOptionGroup, 'key'>[],
): boolean {
  const allowed = new Set<string>(
    productType in OPTION_KEYS_BY_TYPE
      ? OPTION_KEYS_BY_TYPE[productType as keyof typeof OPTION_KEYS_BY_TYPE]
      : [],
  );
  return (
    optionGroups.every((group) => allowed.has(group.key)) &&
    new Set(optionGroups.map(({ key }) => key)).size === optionGroups.length
  );
}

const OPTION_KEYS_BY_TYPE: Record<ProductType, readonly ProductOptionKey[]> =
  PRODUCT_TYPE_OPTION_KEYS;

function invalidSelection(message: string): AppError {
  return new AppError(message, 400, 'INVALID_OPTION_SELECTION');
}

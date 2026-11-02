import { Types } from 'mongoose';
import type { Document } from 'mongodb';

import {
  ArtworkAsset,
  Cart,
  Message,
  Order,
  Product,
  SiteSettings,
} from '../models';
import { convertUsdMinorToGbpMinor } from '../utils/currency';

export const USD_TO_GBP_MIGRATION_ID = 'usd-to-gbp-fixed-20261028-v1';
export const USD_TO_GBP_RATE = '0.752627';
export const USD_TO_GBP_CONFIRMATION = 'USD-to-GBP-20261028';

export type CurrencyMigrationCollection =
  'site_settings' | 'products' | 'carts' | 'messages' | 'artwork_assets';

export interface CurrencyMigrationChange {
  collection: CurrencyMigrationCollection;
  id: string;
  updatedAt: Date;
  expectedCurrency?: string;
  expectedQuoteCurrency?: string | null;
  expectedCartItemId?: string;
  cartItemPrices?: Array<{ id: string; amountMinor: number }>;
  set: Record<string, unknown>;
  unset?: Record<string, unknown>;
}

export interface CurrencyMigrationPlan {
  changes: CurrencyMigrationChange[];
  counts: {
    settings: number;
    products: number;
    carts: number;
    clearedCarts: number;
    unlinkedArtworkAssets: number;
    messages: number;
  };
  examples: Array<{
    recordType: string;
    sourceMinor: number;
    targetMinor: number;
  }>;
  orderCurrencyCounts: Record<string, number>;
}

export class CurrencyMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurrencyMigrationError';
  }
}

/** Convert one integer USD minor-unit amount using the approved fixed rate. */
export function convertUsdMinor(
  amount: unknown,
  field: string,
  allowNegative = false,
): number {
  if (
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    (!allowNegative && amount < 0)
  ) {
    throw new CurrencyMigrationError(
      `${field} must be a safe integer minor-unit amount`,
    );
  }
  try {
    return convertUsdMinorToGbpMinor(amount);
  } catch {
    throw new CurrencyMigrationError(
      `${field} cannot be represented safely in GBP minor units`,
    );
  }
}

/** Build a write-free migration plan and validate every in-scope record. */
export async function buildCurrencyMigrationPlan(): Promise<CurrencyMigrationPlan> {
  const [settings, products, carts, messageQuotes, orderGroups] =
    await Promise.all([
      SiteSettings.find().lean(),
      Product.find().lean(),
      Cart.find().lean(),
      Message.find({ quotedPriceMinor: { $exists: true } })
        .select('_id updatedAt quotedPriceMinor quotedPriceCurrency')
        .lean(),
      Order.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$currency', count: { $sum: 1 } } },
      ]),
    ]);

  const defaultSettings = settings.filter((entry) => entry.key === 'default');
  if (defaultSettings.length !== 1) {
    throw new CurrencyMigrationError(
      'Expected exactly one default site-settings record',
    );
  }
  for (const entry of settings)
    assertSourceCurrency(entry.currency, 'site settings');
  for (const product of products) {
    assertSourceCurrency(product.currency, 'product');
    validateDate(product.updatedAt, 'product');
    if (
      !Array.isArray(product.optionGroups) ||
      !Array.isArray(product.quantityPricing)
    ) {
      throw new CurrencyMigrationError(
        'A product has missing or ambiguous price fields',
      );
    }
    if (product.optionGroups.some((group) => !Array.isArray(group.values))) {
      throw new CurrencyMigrationError(
        'A product option group has missing price values',
      );
    }
  }
  for (const cart of carts) {
    if (cart.currency !== 'USD') {
      throw new CurrencyMigrationError(
        'A cart has a currency other than USD; manual review is required',
      );
    }
    validateDate(cart.updatedAt, 'cart');
    if (!Array.isArray(cart.items)) {
      throw new CurrencyMigrationError(
        'A cart has missing or ambiguous item data',
      );
    }
  }

  const productIds = new Set(products.map((product) => product._id.toString()));
  const changes: CurrencyMigrationChange[] = [];
  const examples: CurrencyMigrationPlan['examples'] = [];
  let migratedMessages = 0;
  let clearedCarts = 0;
  let unlinkedArtworkAssets = 0;

  for (const entry of settings) {
    validateDate(entry.updatedAt, 'site settings');
    const shippingFlatMinor =
      entry.shippingFlatMinor === undefined
        ? undefined
        : convertUsdMinor(entry.shippingFlatMinor, 'shippingFlatMinor');
    const sourceThreshold = entry.freeShippingThresholdMinor;
    const threshold =
      sourceThreshold === undefined || sourceThreshold === null
        ? sourceThreshold
        : convertUsdMinor(sourceThreshold, 'freeShippingThresholdMinor');
    if (typeof sourceThreshold === 'number' && typeof threshold === 'number') {
      addExample(
        examples,
        'free-shipping threshold',
        sourceThreshold,
        threshold,
      );
    }
    const set: Record<string, unknown> = { currency: 'GBP' };
    if (shippingFlatMinor !== undefined) {
      set.shippingFlatMinor = shippingFlatMinor;
      addExample(
        examples,
        'site settings shipping',
        entry.shippingFlatMinor,
        shippingFlatMinor,
      );
    }
    if (threshold !== undefined) set.freeShippingThresholdMinor = threshold;
    changes.push({
      collection: 'site_settings',
      id: entry._id.toString(),
      updatedAt: entry.updatedAt,
      expectedCurrency: 'USD',
      set,
    });
  }

  for (const product of products) {
    const basePriceMinor = convertUsdMinor(
      product.basePriceMinor,
      'basePriceMinor',
    );
    const optionGroups = product.optionGroups.map((group) => ({
      ...group,
      values: group.values.map((value) => {
        const priceModifierMinor = convertUsdMinor(
          value.priceModifierMinor,
          'optionGroups.values.priceModifierMinor',
          true,
        );
        addExample(
          examples,
          'option modifier',
          value.priceModifierMinor,
          priceModifierMinor,
        );
        return { ...value, priceModifierMinor };
      }),
    }));
    const quantityPricing = product.quantityPricing.map((tier) => {
      const unitPriceMinor = convertUsdMinor(
        tier.unitPriceMinor,
        'quantityPricing.unitPriceMinor',
      );
      addExample(
        examples,
        'quantity-tier price',
        tier.unitPriceMinor,
        unitPriceMinor,
      );
      return { ...tier, unitPriceMinor };
    });
    const set: Record<string, unknown> = {
      currency: 'GBP',
      basePriceMinor,
      optionGroups,
      quantityPricing,
    };
    if (product.compareAtPriceMinor !== undefined) {
      const compareAtPriceMinor = convertUsdMinor(
        product.compareAtPriceMinor,
        'compareAtPriceMinor',
      );
      set.compareAtPriceMinor = compareAtPriceMinor;
      addExample(
        examples,
        'product compare-at price',
        product.compareAtPriceMinor,
        compareAtPriceMinor,
      );
    }
    addExample(
      examples,
      'product base price',
      product.basePriceMinor,
      basePriceMinor,
    );
    changes.push({
      collection: 'products',
      id: product._id.toString(),
      updatedAt: product.updatedAt,
      expectedCurrency: 'USD',
      set,
    });
  }

  for (const cart of carts) {
    const referencesMissingProduct = cart.items.some((item) => {
      if (!item.product || typeof item.product.toString !== 'function') {
        return true;
      }
      return !productIds.has(item.product.toString());
    });
    const set: Record<string, unknown> = { currency: 'GBP' };
    if (referencesMissingProduct) {
      set.items = [];
      clearedCarts += 1;
      const itemIds = cart.items.flatMap((item) =>
        item._id ? [item._id] : [],
      );
      if (itemIds.length > 0) {
        const artworkAssets = await ArtworkAsset.find({
          cartItemId: { $in: itemIds },
        })
          .select('_id updatedAt cartItemId')
          .lean();
        for (const asset of artworkAssets) {
          validateDate(asset.updatedAt, 'cart artwork');
          if (!asset.cartItemId) continue;
          changes.push({
            collection: 'artwork_assets',
            id: asset._id.toString(),
            updatedAt: asset.updatedAt,
            expectedCartItemId: asset.cartItemId.toString(),
            set: {},
            unset: { cartItemId: '' },
          });
          unlinkedArtworkAssets += 1;
        }
      }
    } else {
      const cartItemPrices = cart.items.map((item) => {
        if (!item._id) {
          throw new CurrencyMigrationError(
            'A cart item is missing its stable identifier',
          );
        }
        const unitPriceSnapshotMinor = convertUsdMinor(
          item.unitPriceSnapshotMinor,
          'cart.items.unitPriceSnapshotMinor',
        );
        addExample(
          examples,
          'cart snapshot',
          item.unitPriceSnapshotMinor,
          unitPriceSnapshotMinor,
        );
        return {
          id: item._id.toString(),
          amountMinor: unitPriceSnapshotMinor,
        };
      });
      changes.push({
        collection: 'carts',
        id: cart._id.toString(),
        updatedAt: cart.updatedAt,
        expectedCurrency: 'USD',
        set,
        cartItemPrices,
      });
      continue;
    }
    changes.push({
      collection: 'carts',
      id: cart._id.toString(),
      updatedAt: cart.updatedAt,
      expectedCurrency: 'USD',
      set,
    });
  }

  for (const message of messageQuotes) {
    validateDate(message.updatedAt, 'message quote');
    if (message.quotedPriceCurrency === undefined) {
      throw new CurrencyMigrationError(
        'A message quote has no stored currency; manual review is required',
      );
    }
    if (message.quotedPriceCurrency === 'GBP') continue;
    if (message.quotedPriceCurrency !== 'USD') {
      throw new CurrencyMigrationError(
        'A quoted message price has an unexpected currency; manual review is required',
      );
    }
    const sourceQuoteMinor = message.quotedPriceMinor;
    if (typeof sourceQuoteMinor !== 'number') {
      throw new CurrencyMigrationError(
        'quotedPriceMinor must be present for a currency-tagged message quote',
      );
    }
    const quotedPriceMinor = convertUsdMinor(
      sourceQuoteMinor,
      'quotedPriceMinor',
    );
    addExample(examples, 'message quote', sourceQuoteMinor, quotedPriceMinor);
    changes.push({
      collection: 'messages',
      id: message._id.toString(),
      updatedAt: message.updatedAt,
      expectedQuoteCurrency: message.quotedPriceCurrency,
      set: {
        quotedPriceMinor,
        quotedPriceCurrency: 'GBP',
      },
    });
    migratedMessages += 1;
  }

  const orderCurrencyCounts = Object.fromEntries(
    orderGroups.map(({ _id, count }) => [_id || 'MISSING', count]),
  );
  return {
    changes,
    counts: {
      settings: settings.length,
      products: products.length,
      carts: carts.length,
      clearedCarts,
      unlinkedArtworkAssets,
      messages: migratedMessages,
    },
    examples: examples.slice(0, 8),
    orderCurrencyCounts,
  };
}

export async function applyCurrencyMigrationChanges(
  changes: CurrencyMigrationChange[],
  migrationId = USD_TO_GBP_MIGRATION_ID,
): Promise<void> {
  const collections = {
    site_settings: SiteSettings.collection,
    products: Product.collection,
    carts: Cart.collection,
    messages: Message.collection,
    artwork_assets: ArtworkAsset.collection,
  };

  for (const change of changes) {
    const collection = collections[change.collection];
    const filter: Record<string, unknown> = {
      _id: new Types.ObjectId(change.id),
      updatedAt: change.updatedAt,
    };
    if (change.expectedCurrency) filter.currency = change.expectedCurrency;
    if (change.collection === 'messages') {
      filter.quotedPriceCurrency =
        change.expectedQuoteCurrency === undefined
          ? { $exists: false }
          : change.expectedQuoteCurrency;
    }
    if (change.collection === 'artwork_assets' && change.expectedCartItemId) {
      filter.cartItemId = new Types.ObjectId(change.expectedCartItemId);
    }

    const update: {
      $set: Record<string, unknown>;
      $unset?: Record<string, unknown>;
    } = { $set: { ...change.set, _currencyMigrationId: migrationId } };
    if (change.unset) update.$unset = change.unset;
    const updatePipeline: Document[] | undefined = change.cartItemPrices?.length
      ? [
          {
            $set: {
              currency: 'GBP',
              items: {
                $map: {
                  input: { $ifNull: ['$items', []] },
                  as: 'item',
                  in: {
                    $mergeObjects: [
                      '$$item',
                      {
                        unitPriceSnapshotMinor: {
                          $switch: {
                            branches: change.cartItemPrices.map((item) => ({
                              case: {
                                $eq: [
                                  '$$item._id',
                                  new Types.ObjectId(item.id),
                                ],
                              },
                              then: item.amountMinor,
                            })),
                            default: '$$item.unitPriceSnapshotMinor',
                          },
                        },
                      },
                    ],
                  },
                },
              },
              _currencyMigrationId: migrationId,
            },
          },
        ]
      : undefined;
    const result = updatePipeline
      ? await collection.updateOne(filter, updatePipeline)
      : await collection.updateOne(filter, update);
    if (result.modifiedCount === 1) continue;

    const current = await collection.findOne({
      _id: new Types.ObjectId(change.id),
      _currencyMigrationId: migrationId,
    });
    if (!current) {
      throw new CurrencyMigrationError(
        `A ${change.collection} record changed after preview; resume after reviewing the migration journal`,
      );
    }
  }
}

export async function cleanCurrencyMigrationMarkers(
  migrationId = USD_TO_GBP_MIGRATION_ID,
): Promise<void> {
  await Promise.all([
    SiteSettings.collection.updateMany(
      { _currencyMigrationId: migrationId },
      { $unset: { _currencyMigrationId: '' } },
    ),
    Product.collection.updateMany(
      { _currencyMigrationId: migrationId },
      { $unset: { _currencyMigrationId: '' } },
    ),
    Cart.collection.updateMany(
      { _currencyMigrationId: migrationId },
      { $unset: { _currencyMigrationId: '' } },
    ),
    Message.collection.updateMany(
      { _currencyMigrationId: migrationId },
      { $unset: { _currencyMigrationId: '' } },
    ),
    ArtworkAsset.collection.updateMany(
      { _currencyMigrationId: migrationId },
      { $unset: { _currencyMigrationId: '' } },
    ),
  ]);
}

function assertSourceCurrency(
  currency: string | undefined,
  recordType: string,
) {
  if (currency !== 'USD') {
    throw new CurrencyMigrationError(
      `A ${recordType} record does not use USD; manual review is required`,
    );
  }
}

function validateDate(
  value: Date | undefined,
  field: string,
): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new CurrencyMigrationError(
      `${field} is missing a valid update timestamp`,
    );
  }
}

function addExample(
  examples: CurrencyMigrationPlan['examples'],
  recordType: string,
  sourceMinor: number,
  targetMinor: number,
) {
  if (examples.length < 8)
    examples.push({ recordType, sourceMinor, targetMinor });
}

import { randomUUID } from 'node:crypto';
import mongoose, { Types } from 'mongoose';

import { ALL_PRODUCT_TYPES, type ProductType } from '../constants/product';
import {
  ArtworkAsset,
  Category,
  CustomOffer,
  Message,
  Order,
  Product,
  User,
} from '../models';
import type { IUser } from '../models/User';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { startOrderCheckout } from './payment/paymentFlow.service';
import { logAuditEvent } from './audit.service';
import {
  deleteArtwork,
  saveArtworkUpload,
  type UploadedArtworkFile,
} from './upload.service';

export interface CreateCustomOfferInput {
  title: string;
  description: string;
  categoryId: string;
  productType: ProductType;
  size: string;
  colours?: string;
  materials?: string;
  personalisation?: string;
  additionalInstructions?: string;
  agreedQuantity: number;
  agreedPriceMinor: number;
  currency: 'GBP';
  expiresAt: Date;
}

export interface CustomOfferSummary {
  id: string;
  status: 'available' | 'reserved' | 'purchased' | 'expired' | 'cancelled';
  agreedPriceMinor: number;
  currency: 'GBP';
  agreedQuantity: number;
  specifications: Array<{ label: string; value: string }>;
  expiresAt: Date;
  product: {
    id: string;
    title: string;
    description: string;
    productType: string;
  };
  image: {
    id: string;
    originalFilename: string;
    detectedMimeType: string;
    width: number | null;
    height: number | null;
    url: string;
  } | null;
}

interface CustomerOfferRecord {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  status: CustomOfferSummary['status'];
  agreedPriceMinor: number;
  currency: 'GBP';
  agreedQuantity: number;
  specifications: Array<{ label: string; value: string }>;
  expiresAt: Date;
  reservedAt?: Date;
  reservationExpiresAt?: Date;
  purchasedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
}

export interface CustomerCustomOffer {
  id: string;
  status: CustomerOfferRecord['status'];
  agreedPriceMinor: number;
  currency: CustomerOfferRecord['currency'];
  agreedQuantity: number;
  specifications: CustomerOfferRecord['specifications'];
  expiresAt: Date;
  reservedAt?: Date;
  reservationExpiresAt?: Date;
  purchasedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  product: {
    id: string;
    title: string;
    description: string;
    productType: string;
    media: Array<{ url: string; alt?: string; isPrimary?: boolean }>;
  };
}

export async function listCustomerCustomOffers(
  customer: IUser,
): Promise<CustomerCustomOffer[]> {
  assertCustomer(customer);
  const offers = await CustomOffer.find(customerOfferFilter(customer._id))
    .sort({ createdAt: -1 })
    .lean<CustomerOfferRecord[]>();
  return loadCustomerOfferDetails(offers);
}

export async function getCustomerCustomOffer(
  offerId: string,
  customer: IUser,
): Promise<CustomerCustomOffer> {
  assertCustomer(customer);
  if (!mongoose.isValidObjectId(offerId)) throw customOfferNotFound();
  const offer = await CustomOffer.findOne(
    customerOfferFilter(customer._id, offerId),
  ).lean<CustomerOfferRecord | null>();
  if (!offer) throw customOfferNotFound();
  const [detail] = await loadCustomerOfferDetails([offer]);
  if (!detail) throw customOfferNotFound();
  return detail;
}

export function customerOfferFilter(
  customerId: string | Types.ObjectId,
  offerId?: string | Types.ObjectId,
) {
  return {
    customer: customerId,
    ...(offerId ? { _id: offerId } : {}),
  };
}

export interface CustomOfferOrderCreationResult {
  offerId: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  totalMinor: number;
  currency: 'GBP';
  productionQuantity: number;
  created: boolean;
}

export interface CustomOfferCheckoutStartResult
  extends CustomOfferOrderCreationResult {
  checkoutUrl: string;
  expiresAt: Date;
}

export async function createCustomOfferOrder(
  customer: IUser,
  offerId: string,
): Promise<CustomOfferOrderCreationResult> {
  return reserveCustomOfferForCheckout(customer, offerId);
}

export async function startCustomerCustomOfferCheckout(
  customer: IUser,
  offerId: string,
): Promise<CustomOfferCheckoutStartResult> {
  const order = await reserveCustomOfferForCheckout(customer, offerId);
  const checkout = await startOrderCheckout(order.orderNumber, { user: customer });
  return {
    ...order,
    checkoutUrl: checkout.checkoutUrl,
    expiresAt: checkout.expiresAt,
  };
}

export async function startCustomerCustomOfferCheckoutForRequest(
  customer: IUser,
  requestId: string,
): Promise<CustomOfferCheckoutStartResult> {
  const offer = await getCustomerCustomOfferForRequest(requestId, customer);
  if (!offer) throw customOfferNotFound();
  return startCustomerCustomOfferCheckout(customer, offer.id);
}

export async function purchaseCustomOffer(
  customer: IUser,
  offerId: string,
): Promise<CustomOfferOrderCreationResult> {
  return reserveCustomOfferForCheckout(customer, offerId);
}

export async function reserveCustomOfferForCheckout(
  customer: IUser,
  offerId: string,
): Promise<CustomOfferOrderCreationResult> {
  assertCustomer(customer);
  if (!mongoose.isValidObjectId(offerId)) throw customOfferNotFound();

  const now = new Date();
  const offer = await CustomOffer.findOne({
    _id: offerId,
    customer: customer._id,
  })
    .select(
      '_id customer product status order agreedPriceMinor currency agreedQuantity expiresAt reservedAt reservationExpiresAt purchasedAt cancelledAt cancellationReason',
    )
    .lean();

  if (!offer) throw customOfferNotFound();
  if (offer.status === 'purchased') {
    throw new AppError(
      'This offer has already been purchased',
      409,
      'CUSTOM_OFFER_ALREADY_PURCHASED',
    );
  }
  if (offer.status === 'cancelled') {
    throw new AppError(
      'This offer has been cancelled and is no longer available',
      409,
      'CUSTOM_OFFER_CANCELLED',
    );
  }
  if (offer.expiresAt <= now || offer.status === 'expired') {
    await CustomOffer.updateOne(
      { _id: offer._id, status: { $in: ['available', 'reserved'] } },
      { $set: { status: 'expired' } },
    );
    throw new AppError(
      'This offer has expired and cannot be purchased',
      409,
      'CUSTOM_OFFER_EXPIRED',
    );
  }

  const existingOrder = offer.order
    ? await Order.findOne({
        _id: offer.order,
        user: customer._id,
        customOffer: offer._id,
      }).lean()
    : null;

  if (existingOrder) {
    assertPrivateOfferOrderMatchesOffer(offer, existingOrder);
    const pendingStatus = ['pending_payment', 'processing', 'paid'];
    if (pendingStatus.includes(existingOrder.status)) {
      if (
        existingOrder.status === 'pending_payment' &&
        (existingOrder.payment.status === 'pending' ||
          existingOrder.payment.status === 'failed')
      ) {
        await CustomOffer.updateOne(
          { _id: offer._id, status: 'available' },
          {
            $set: {
              status: 'reserved',
              reservedAt: existingOrder.createdAt ?? now,
              reservationExpiresAt: new Date(
                Date.now() + 15 * 60 * 1000,
              ),
              order: existingOrder._id,
            },
          },
        );
      }
      return serializeCustomOfferOrder(existingOrder, offer, false);
    }
  }

  const product = await Product.findOne({
    _id: offer.product,
    visibility: 'private',
  })
    .select('_id title sku')
    .lean();

  if (!product) {
    throw new AppError(
      'This private offer is missing its protected product',
      409,
      'CUSTOM_OFFER_PRODUCT_INTEGRITY_ERROR',
    );
  }

  const offerReservation = await CustomOffer.findOneAndUpdate(
    {
      _id: offer._id,
      customer: customer._id,
      status: 'available',
      expiresAt: { $gt: now },
    },
    {
      $set: {
        status: 'reserved',
        reservedAt: now,
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    },
    { new: true },
  );

  if (!offerReservation) {
    let current = await CustomOffer.findOne({
      _id: offer._id,
      customer: customer._id,
    })
      .select(
        '_id customer product status order agreedPriceMinor currency agreedQuantity expiresAt reservedAt reservationExpiresAt purchasedAt cancelledAt cancellationReason',
      )
      .lean();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const existingOrder = await Order.findOne({
        customOffer: offer._id,
        user: customer._id,
      }).lean();

      if (existingOrder) {
        if (current) assertPrivateOfferOrderMatchesOffer(current, existingOrder);
        return serializeCustomOfferOrder(existingOrder, current ?? offer, false);
      }

      if (current?.order) {
        const pendingOrder = await Order.findOne({
          _id: current.order,
          customOffer: offer._id,
          user: customer._id,
        }).lean();
        if (
          pendingOrder &&
          ['pending_payment', 'processing'].includes(pendingOrder.status)
        ) {
          assertPrivateOfferOrderMatchesOffer(current, pendingOrder);
          return serializeCustomOfferOrder(pendingOrder, current, false);
        }
      }

      if (!current || current.status !== 'reserved') {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      current = await CustomOffer.findOne({
        _id: offer._id,
        customer: customer._id,
      })
        .select(
          '_id customer product status order agreedPriceMinor currency agreedQuantity expiresAt reservedAt reservationExpiresAt purchasedAt cancelledAt cancellationReason',
        )
        .lean();
    }
    throw new AppError(
      'This offer is no longer available for purchase',
      409,
      'CUSTOM_OFFER_UNAVAILABLE',
    );
  }

  const existingOrderForOffer = await Order.findOne({
    customOffer: offer._id,
  }).lean();
  if (existingOrderForOffer) {
    assertPrivateOfferOrderMatchesOffer(offer, existingOrderForOffer);
  }

  const defaultAddress = customer.addresses.find((address) => address.isDefault)
    ?? customer.addresses[0];
  const shippingAddress = defaultAddress
    ? {
        line1: defaultAddress.line1,
        line2: defaultAddress.line2,
        city: defaultAddress.city,
        state: defaultAddress.state,
        postalCode: defaultAddress.postalCode,
        country: defaultAddress.country,
      }
    : {
        line1: 'Custom offer delivery',
        city: 'London',
        state: 'London',
        postalCode: 'SW1A 1AA',
        country: 'GB',
      };

  const idempotencyKey = `custom-offer:${offer._id.toString()}`;
  const order = await Order.findOne({ customOffer: offer._id }).lean();
  if (order) {
    return serializeCustomOfferOrder(order, offer, false);
  }

  try {
    const createdOrder = await Order.create({
      user: customer._id,
      customOffer: offer._id,
      contactSnapshot: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
      shippingAddress,
      billingAddress: shippingAddress,
      items: [
        {
          product: product._id,
          titleSnapshot: product.title,
          skuSnapshot: product.sku,
          selectedOptions: [],
          quantity: 1,
          productionQuantity: offer.agreedQuantity,
          unitPriceMinor: offer.agreedPriceMinor,
          lineTotalMinor: offer.agreedPriceMinor,
          itemPrintStatus: 'queued',
          requiresProof: false,
        },
      ],
      subtotalMinor: offer.agreedPriceMinor,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: offer.agreedPriceMinor,
      currency: offer.currency,
      payment: {
        provider: 'stripe',
        status: 'pending',
        stripeCheckoutAttempt: 0,
      },
      status: 'pending_payment',
      statusHistory: [
        {
          from: 'pending_payment',
          to: 'pending_payment',
          note: 'Private offer checkout reserved',
          at: new Date(),
        },
      ],
      idempotencyKey,
      idempotencyScope: `customer:${customer._id.toString()}`,
      notes: 'Private custom offer order',
      reservedStock: [],
    });

    await CustomOffer.updateOne(
      { _id: offer._id, status: 'reserved' },
      {
        $set: {
          order: createdOrder._id,
          status: 'reserved',
          reservedAt: now,
          reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      },
    );

    return serializeCustomOfferOrder(createdOrder.toObject(), offer, true);
  } catch (error) {
    if (isDuplicateKey(error)) {
      const duplicate = await Order.findOne({ customOffer: offer._id }).lean();
      if (duplicate) return serializeCustomOfferOrder(duplicate, offer, false);
    }
    throw error;
  }
}

function serializeCustomOfferOrder(
  order: {
    _id: Types.ObjectId;
    orderNumber: string;
    totalMinor: number;
    currency: string;
    status: string;
    customOffer?: Types.ObjectId;
    user?: Types.ObjectId;
    payment?: { status: string };
  },
  offer: {
    _id: Types.ObjectId;
    agreedPriceMinor: number;
    currency: 'GBP';
    agreedQuantity: number;
  },
  created: boolean,
): CustomOfferOrderCreationResult {
  return {
    offerId: offer._id.toString(),
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    customerId: order.user?.toString() ?? '',
    totalMinor: order.totalMinor ?? offer.agreedPriceMinor,
    currency: (order.currency ?? offer.currency) as 'GBP',
    productionQuantity: offer.agreedQuantity,
    created,
  };
}

/** Creates an accepted request's private product and offer with compensating cleanup. */
export async function createCustomOfferForRequest(
  requestId: string,
  input: CreateCustomOfferInput,
  file: UploadedArtworkFile | undefined,
  actor: IUser,
): Promise<CustomOfferSummary> {
  if (actor.role !== 'admin') {
    throw new AppError('Admin role required', 403, 'FORBIDDEN');
  }
  if (!mongoose.isValidObjectId(requestId)) {
    throw customRequestNotFound();
  }
  if (!file) throw new AppError('A mockup image is required', 400, 'NO_FILE');
  if (!(input.expiresAt instanceof Date) || input.expiresAt <= new Date()) {
    throw new AppError(
      'Offer expiry must be in the future',
      400,
      'CUSTOM_OFFER_EXPIRY_INVALID',
    );
  }
  if (!ALL_PRODUCT_TYPES.includes(input.productType)) {
    throw new AppError(
      'The selected product type is not supported',
      400,
      'CUSTOM_OFFER_PRODUCT_TYPE_INVALID',
    );
  }
  if (!Types.ObjectId.isValid(input.categoryId)) {
    throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
  }

  const request = await Message.findOne({
    _id: requestId,
    type: 'custom_3d_request',
  }).select('customerId customRequestStatus');
  if (!request) throw customRequestNotFound();
  if (await CustomOffer.exists({ request: request._id })) {
    throw customOfferAlreadyExists();
  }
  if (request.customRequestStatus !== 'accepted') {
    throw new AppError(
      'Only accepted custom requests can receive an offer',
      409,
      'CUSTOM_REQUEST_NOT_ACCEPTED',
    );
  }
  if (!request.customerId) {
    throw new AppError(
      'A registered customer account is required to create an offer',
      409,
      'CUSTOM_REQUEST_CUSTOMER_REQUIRED',
    );
  }
  const [customer, category] = await Promise.all([
    User.findOne({
      _id: request.customerId,
      role: 'customer',
      accountState: 'active',
    }).select('_id role'),
    Category.findOne({ _id: input.categoryId, isActive: true }).select('_id'),
  ]);
  if (!customer) {
    throw new AppError(
      'The linked customer account is unavailable',
      409,
      'CUSTOM_REQUEST_CUSTOMER_REQUIRED',
    );
  }
  if (!category) {
    throw new AppError('Active category not found', 404, 'CATEGORY_NOT_FOUND');
  }

  const specifications = [
    { label: 'Size and dimensions', value: input.size },
    ...(input.colours ? [{ label: 'Colours', value: input.colours }] : []),
    ...(input.materials
      ? [{ label: 'Materials', value: input.materials }]
      : []),
    ...(input.personalisation
      ? [{ label: 'Personalisation', value: input.personalisation }]
      : []),
    ...(input.additionalInstructions
      ? [
          {
            label: 'Additional instructions',
            value: input.additionalInstructions,
          },
        ]
      : []),
  ];
  let artworkId: string | undefined;
  let productId: Types.ObjectId | undefined;
  let offerId: Types.ObjectId | undefined;
  let requestTransitioned = false;

  try {
    const artwork = await saveArtworkUpload({ user: customer }, file, true);
    artworkId = artwork.id;

    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const product = await Product.create({
      title: input.title,
      slug: `custom-offer-${request._id.toString()}-${suffix}`,
      description: input.description,
      category: category._id,
      productType: input.productType,
      media: [],
      sku: `CUSTOM-${request._id.toString()}-${suffix}`.toUpperCase(),
      basePriceMinor: input.agreedPriceMinor,
      currency: input.currency,
      optionGroups: [],
      quantityPricing: [],
      printTechniques: [],
      specifications,
      artworkRequirements: { allowedFormats: [] },
      artworkRequired: false,
      stock: {
        trackInventory: false,
        quantity: 0,
        lowStockThreshold: 0,
        allowBackorder: false,
        reserveBlanksForMadeToOrder: false,
      },
      status: 'active',
      visibility: 'private',
      seo: {},
      viewCount: 0,
      soldCount: 0,
      ratingAverage: 0,
      ratingCount: 0,
      isFeatured: false,
      minOrderQuantity: 1,
      maxOrderQuantity: 1,
    });
    productId = product._id;

    const offer = await CustomOffer.create({
      request: request._id,
      product: product._id,
      customer: customer._id,
      image: new Types.ObjectId(artworkId),
      status: 'available',
      agreedPriceMinor: input.agreedPriceMinor,
      currency: input.currency,
      agreedQuantity: input.agreedQuantity,
      specifications,
      expiresAt: input.expiresAt,
    });
    offerId = offer._id;

    const imageLink = await ArtworkAsset.updateOne(
      {
        _id: artworkId,
        owner: customer._id,
        customOffer: { $exists: false },
      },
      { $set: { customOffer: offer._id } },
    );
    if (imageLink.matchedCount !== 1) {
      throw new AppError(
        'The private offer image could not be linked',
        409,
        'CUSTOM_OFFER_IMAGE_LINK_FAILED',
      );
    }

    const transitioned = await Message.findOneAndUpdate(
      {
        _id: request._id,
        type: 'custom_3d_request',
        customerId: customer._id,
        customRequestStatus: 'accepted',
      },
      { $set: { customRequestStatus: 'offer_created' } },
      { new: true },
    );
    if (!transitioned) {
      throw new AppError(
        'The request changed while its offer was being created',
        409,
        'CUSTOM_REQUEST_TRANSITION_INVALID',
      );
    }
    requestTransitioned = true;

    const result = await getAdminCustomOfferForRequest(requestId);
    if (!result) {
      throw new AppError(
        'The created offer could not be loaded',
        500,
        'CUSTOM_OFFER_READ_FAILED',
      );
    }
    await logAuditEvent({
      actor,
      action: 'custom_offer.created',
      targetType: 'CustomOffer',
      targetId: offer._id.toString(),
      metadata: {
        requestId,
        productId: product._id.toString(),
        customerId: customer._id.toString(),
        agreedPriceMinor: input.agreedPriceMinor,
        currency: input.currency,
      },
    });
    return result;
  } catch (error) {
    try {
      if (requestTransitioned) {
        await Message.updateOne(
          {
            _id: request._id,
            customRequestStatus: 'offer_created',
          },
          { $set: { customRequestStatus: 'accepted' } },
        );
      }
      if (offerId) {
        await CustomOffer.deleteOne({ _id: offerId });
      }
      if (artworkId && offerId) {
        await ArtworkAsset.updateOne(
          { _id: artworkId, customOffer: offerId },
          { $unset: { customOffer: 1 } },
        );
      }
      if (productId) await Product.deleteOne({ _id: productId });
      if (artworkId) {
        await deleteArtwork(artworkId, { user: customer });
      }
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError, requestId, productId, offerId, artworkId },
        'Custom offer rollback failed',
      );
      throw new AppError(
        'Custom offer creation failed and cleanup was incomplete',
        500,
        'CUSTOM_OFFER_CLEANUP_FAILED',
      );
    }
    if (
      isDuplicateKey(error) ||
      (await CustomOffer.exists({ request: request._id }))
    ) {
      throw customOfferAlreadyExists();
    }
    const currentRequest = await Message.findById(request._id)
      .select('customRequestStatus')
      .lean();
    if (currentRequest?.customRequestStatus !== 'accepted') {
      throw new AppError(
        'The request changed while its offer was being created',
        409,
        'CUSTOM_REQUEST_TRANSITION_INVALID',
      );
    }
    throw error;
  }
}

/** Returns offer terms only to an administrator viewing the linked request. */
export async function getAdminCustomOfferForRequest(
  requestId: string,
): Promise<CustomOfferSummary | null> {
  const offer = await CustomOffer.findOne({ request: requestId }).lean();
  return offer ? loadOfferSummary(offer, false) : null;
}

/** Returns offer terms only to the customer recorded on the original request. */
export async function getCustomerCustomOfferForRequest(
  requestId: string,
  customer: IUser,
): Promise<CustomOfferSummary | null> {
  assertCustomer(customer);
  const request = await Message.findOne({
    _id: requestId,
    type: 'custom_3d_request',
    customerId: customer._id,
  })
    .select('_id')
    .lean();
  if (!request) throw customRequestNotFound();
  const offer = await CustomOffer.findOne({
    request: request._id,
    customer: customer._id,
  }).lean();
  return offer ? loadOfferSummary(offer, true) : null;
}

/** Resolves the private mockup only through its administrator-owned request. */
export async function getAdminCustomOfferImageId(
  requestId: string,
): Promise<string> {
  const offer = await CustomOffer.findOne({ request: requestId })
    .select('_id customer image')
    .lean();
  if (!offer?.image) throw customOfferImageNotFound();
  const image = await ArtworkAsset.findOne({
    _id: offer.image,
    owner: offer.customer,
    customOffer: offer._id,
  })
    .select('_id')
    .lean();
  if (!image) throw customOfferImageNotFound();
  return image._id.toString();
}

/** Resolves the private mockup only for the customer who owns the request. */
export async function getCustomerCustomOfferImageId(
  requestId: string,
  customer: IUser,
): Promise<string> {
  assertCustomer(customer);
  const request = await Message.findOne({
    _id: requestId,
    type: 'custom_3d_request',
    customerId: customer._id,
  })
    .select('_id')
    .lean();
  if (!request) throw customRequestNotFound();
  const offer = await CustomOffer.findOne({
    request: request._id,
    customer: customer._id,
  })
    .select('_id image')
    .lean();
  if (!offer?.image) throw customOfferImageNotFound();
  const image = await ArtworkAsset.findOne({
    _id: offer.image,
    owner: customer._id,
    customOffer: offer._id,
  })
    .select('_id')
    .lean();
  if (!image) throw customOfferImageNotFound();
  return image._id.toString();
}

async function loadOfferSummary(
  offer: {
    _id: Types.ObjectId;
    request: Types.ObjectId;
    product: Types.ObjectId;
    customer: Types.ObjectId;
    image?: Types.ObjectId;
    status: CustomOfferSummary['status'];
    agreedPriceMinor: number;
    currency: 'GBP';
    agreedQuantity: number;
    specifications: Array<{ label: string; value: string }>;
    expiresAt: Date;
  },
  customerScoped: boolean,
): Promise<CustomOfferSummary> {
  const [product, artwork] = await Promise.all([
    Product.findOne({ _id: offer.product, visibility: 'private' })
      .select('title description productType')
      .lean(),
    offer.image
      ? ArtworkAsset.findOne({
          _id: offer.image,
          owner: offer.customer,
          customOffer: offer._id,
        })
          .select('originalFilename detectedMimeType width height')
          .lean()
      : null,
  ]);
  if (!product) {
    throw new AppError(
      'A custom offer is missing its private product',
      409,
      'CUSTOM_OFFER_PRODUCT_INTEGRITY_ERROR',
    );
  }
  return {
    id: offer._id.toString(),
    status: offer.status,
    agreedPriceMinor: offer.agreedPriceMinor,
    currency: offer.currency,
    agreedQuantity: offer.agreedQuantity,
    specifications: offer.specifications,
    expiresAt: offer.expiresAt,
    product: {
      id: product._id.toString(),
      title: product.title,
      description: product.description,
      productType: product.productType,
    },
    image: artwork
      ? {
          id: offer.image!.toString(),
          originalFilename: artwork.originalFilename,
          detectedMimeType: artwork.detectedMimeType,
          width: artwork.width ?? null,
          height: artwork.height ?? null,
          url: customerScoped
            ? `/api/messages/custom-requests/${offer.request.toString()}/offer-image`
            : `/api/admin/messages/${offer.request.toString()}/custom-offer/image`,
        }
      : null,
  };
}

async function loadCustomerOfferDetails(
  offers: readonly CustomerOfferRecord[],
): Promise<CustomerCustomOffer[]> {
  if (!offers.length) return [];
  const products = await Product.find({
    _id: { $in: offers.map((offer) => offer.product) },
    visibility: 'private',
  })
    .select('title description productType media')
    .lean();
  const productById = new Map(
    products.map((product) => [product._id.toString(), product]),
  );
  if (productById.size !== offers.length) {
    throw new AppError(
      'A custom offer is missing its private product',
      409,
      'CUSTOM_OFFER_PRODUCT_INTEGRITY_ERROR',
    );
  }
  return offers.map((offer) => {
    const product = productById.get(offer.product.toString());
    if (!product) {
      throw new AppError(
        'A custom offer is missing its private product',
        409,
        'CUSTOM_OFFER_PRODUCT_INTEGRITY_ERROR',
      );
    }
    return {
      id: offer._id.toString(),
      status: offer.status,
      agreedPriceMinor: offer.agreedPriceMinor,
      currency: offer.currency,
      agreedQuantity: offer.agreedQuantity,
      specifications: offer.specifications,
      expiresAt: offer.expiresAt,
      ...(offer.reservedAt ? { reservedAt: offer.reservedAt } : {}),
      ...(offer.reservationExpiresAt
        ? { reservationExpiresAt: offer.reservationExpiresAt }
        : {}),
      ...(offer.purchasedAt ? { purchasedAt: offer.purchasedAt } : {}),
      ...(offer.cancelledAt ? { cancelledAt: offer.cancelledAt } : {}),
      ...(offer.cancellationReason
        ? { cancellationReason: offer.cancellationReason }
        : {}),
      product: {
        id: product._id.toString(),
        title: product.title,
        description: product.description,
        productType: product.productType,
        media: product.media.map((image) => ({
          url: image.url,
          alt: image.alt,
          isPrimary: image.isPrimary,
        })),
      },
    };
  });
}

function customOfferNotFound(): AppError {
  return new AppError('Custom offer not found', 404, 'CUSTOM_OFFER_NOT_FOUND');
}

function assertCustomer(customer: IUser): void {
  if (customer.role !== 'customer') {
    throw new AppError(
      'A customer account is required',
      403,
      'CUSTOMER_ACCOUNT_REQUIRED',
    );
  }
}

function assertPrivateOfferOrderMatchesOffer(
  offer: {
    _id: Types.ObjectId;
    customer: Types.ObjectId;
    product: Types.ObjectId;
    agreedPriceMinor: number;
    currency: 'GBP';
    agreedQuantity: number;
  },
  order: {
    _id: Types.ObjectId;
    customOffer?: Types.ObjectId;
    user?: Types.ObjectId;
    totalMinor?: number;
    currency?: string;
    items?: Array<{
      product: Types.ObjectId;
      quantity: number;
      lineTotalMinor: number;
      productionQuantity?: number;
    }>;
  },
): void {
  if (order.customOffer && order.customOffer.toString() !== offer._id.toString()) {
    throw new AppError(
      'Private offer order does not match the offer',
      409,
      'CUSTOM_OFFER_ORDER_MISMATCH',
    );
  }
  if (!order.user || order.user.toString() !== offer.customer.toString()) {
    throw new AppError(
      'Private offer order does not belong to the owning customer',
      409,
      'CUSTOM_OFFER_CUSTOMER_MISMATCH',
    );
  }
  const items = order.items ?? [];
  if (items.length !== 1) {
    throw new AppError(
      'Private offer orders must contain exactly one line item',
      409,
      'CUSTOM_OFFER_ORDER_MISMATCH',
    );
  }
  const [item] = items;
  if (item.product.toString() !== offer.product.toString()) {
    throw new AppError(
      'Private offer order product does not match the offer product',
      409,
      'CUSTOM_OFFER_PRODUCT_MISMATCH',
    );
  }
  if (item.quantity !== 1) {
    throw new AppError(
      'Private offer orders must have a single order quantity',
      409,
      'CUSTOM_OFFER_ORDER_MISMATCH',
    );
  }
  if ((item.productionQuantity ?? item.quantity) !== offer.agreedQuantity) {
    throw new AppError(
      'Private offer production quantity does not match the agreed quantity',
      409,
      'CUSTOM_OFFER_QUANTITY_MISMATCH',
    );
  }
  if (item.lineTotalMinor !== offer.agreedPriceMinor) {
    throw new AppError(
      'Private offer order total does not match the agreed fixed price',
      409,
      'CUSTOM_OFFER_PRICE_MISMATCH',
    );
  }
  if ((order.totalMinor ?? offer.agreedPriceMinor) !== offer.agreedPriceMinor) {
    throw new AppError(
      'Private offer order total does not match the agreed fixed price',
      409,
      'CUSTOM_OFFER_PRICE_MISMATCH',
    );
  }
  if ((order.currency ?? offer.currency).toUpperCase() !== offer.currency.toUpperCase()) {
    throw new AppError(
      'Private offer order currency does not match the agreed currency',
      409,
      'CUSTOM_OFFER_CURRENCY_MISMATCH',
    );
  }
}

function customRequestNotFound(): AppError {
  return new AppError(
    'Custom request not found',
    404,
    'CUSTOM_REQUEST_NOT_FOUND',
  );
}

function customOfferImageNotFound(): AppError {
  return new AppError(
    'Offer image not found',
    404,
    'CUSTOM_OFFER_IMAGE_NOT_FOUND',
  );
}

function customOfferAlreadyExists(): AppError {
  return new AppError(
    'A private offer already exists for this request',
    409,
    'CUSTOM_OFFER_ALREADY_EXISTS',
  );
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

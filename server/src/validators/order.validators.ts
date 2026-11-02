import { z } from 'zod';

import { ORDER_STATUS_TRANSITIONS } from '../constants/order';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const orderNumber = z.string().trim().min(1).max(40);
const note = z.string().trim().max(2000).optional();
const address = z
  .object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(120),
    state: z.string().trim().min(1).max(120),
    postalCode: z.string().trim().min(1).max(40),
    country: z.string().trim().min(2).max(100),
  })
  .strict();

export const checkoutPreviewSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const createOrderSchema = z.object({
  params: z.object({}),
  body: z
    .object({
      contact: z
        .object({
          name: z.string().trim().min(1).max(120),
          email: z.string().trim().email().max(254),
          phone: z.string().trim().max(40).optional(),
        })
        .strict(),
      shippingAddress: address,
      billingAddress: address.optional(),
      billingSameAsShipping: z.boolean().default(false),
      customerNote: z.string().trim().max(2000).optional(),
    })
    .strict()
    .superRefine((body, ctx) => {
      if (!body.billingAddress && !body.billingSameAsShipping) {
        ctx.addIssue({
          code: 'custom',
          path: ['billingAddress'],
          message: 'Provide billingAddress or set billingSameAsShipping',
        });
      }
    }),
  query: z.object({}),
});

export const orderListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      status: z
        .enum(
          Object.keys(ORDER_STATUS_TRANSITIONS) as [
            keyof typeof ORDER_STATUS_TRANSITIONS,
            ...Array<keyof typeof ORDER_STATUS_TRANSITIONS>,
          ],
        )
        .optional(),
    })
    .strict(),
});

export const orderNumberSchema = z.object({
  params: z.object({ orderNumber }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const orderPaymentStartSchema = z.object({
  params: z.object({ orderNumber }),
  body: z
    .object({ email: z.string().trim().email().max(254).optional() })
    .strict(),
  query: z.object({}),
});

export const orderPaymentConfirmSchema = z.object({
  params: z.object({ orderNumber }),
  body: z
    .object({ email: z.string().trim().email().max(254).optional() })
    .strict()
    .optional(),
  query: z.object({}),
});

export const orderPaymentStatusSchema = z.object({
  params: z.object({ orderNumber }),
  body: z.object({}).optional(),
  query: z
    .object({ email: z.string().trim().email().max(254).optional() })
    .strict(),
});

export const orderLookupSchema = z.object({
  params: z.object({}),
  body: z
    .object({
      orderNumber,
      email: z.string().trim().email().max(254),
    })
    .strict(),
  query: z.object({}),
});

export const customerArtworkSchema = z.object({
  params: z.object({ orderNumber, itemId: objectId }),
  body: z
    .object({
      artworkId: objectId,
      email: z.string().trim().email().max(254).optional(),
    })
    .strict(),
  query: z.object({}),
});

export const adminOrderListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      tab: z
        .enum([
          'all',
          'pending_payment',
          'pending_proof_approval',
          'artwork_rejected',
          'in_printing',
          'ready',
          'shipped',
          'completed',
          'cancelled',
        ])
        .default('all'),
      q: z.string().trim().max(200).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      sort: z
        .enum(['newest', 'oldest', 'total_asc', 'total_desc'])
        .default('newest'),
    })
    .strict(),
});

export const adminOrderIdSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const completeOrderSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ note }).strict().optional(),
  query: z.object({}),
});

export const statusUpdateSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      status: z.enum(
        Object.keys(ORDER_STATUS_TRANSITIONS) as [
          keyof typeof ORDER_STATUS_TRANSITIONS,
          ...Array<keyof typeof ORDER_STATUS_TRANSITIONS>,
        ],
      ),
      note,
    })
    .strict(),
  query: z.object({}),
});

export const paymentRecordSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      status: z.enum(['paid', 'failed']),
      reference: z.string().trim().max(200).optional(),
      amountMinor: z.number().int().min(0),
      method: z.string().trim().min(1).max(80),
      note,
    })
    .strict(),
  query: z.object({}),
});

export const adminProofSchema = z.object({
  params: z.object({ id: objectId, itemId: objectId }),
  body: z
    .object({
      decision: z.enum(['approved', 'replacement_requested']),
      note,
    })
    .strict()
    .superRefine((body, ctx) => {
      if (body.decision === 'replacement_requested' && !body.note) {
        ctx.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'A note is required when requesting a replacement',
        });
      }
    }),
  query: z.object({}),
});

export const printStatusSchema = z.object({
  params: z.object({ id: objectId, itemId: objectId }),
  body: z
    .object({
      status: z.enum([
        'queued',
        'printing',
        'printed',
        'quality_check',
        'ready',
      ]),
      note,
    })
    .strict(),
  query: z.object({}),
});

export const dispatchSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      carrier: z.string().trim().min(1).max(100),
      trackingNumber: z.string().trim().min(1).max(200),
      trackingUrl: z.string().url().optional(),
      note,
    })
    .strict(),
  query: z.object({}),
});

export const cancelAdminSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      reason: z.string().trim().min(1).max(2000),
      restock: z.boolean(),
    })
    .strict(),
  query: z.object({}),
});

export const refundSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      amountMinor: z.number().int().positive(),
      reason: z.string().trim().min(1).max(1000),
      reference: z.string().trim().max(200).optional(),
    })
    .strict(),
  query: z.object({}),
});

export const internalNoteSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ note: z.string().trim().min(1).max(2000) }).strict(),
  query: z.object({}),
});

export const printQueueSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      technique: z.string().trim().max(50).optional(),
      status: z.enum(['in_printing', 'ready']).optional(),
      q: z.string().trim().max(200).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .strict(),
});

export const customerListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      q: z.string().trim().max(200).optional(),
    })
    .strict(),
});

export const customerIdSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const orderCancelCustomerSchema = z.object({
  params: z.object({ orderNumber }),
  body: z
    .object({ email: z.string().trim().email().max(254).optional() })
    .strict()
    .optional(),
  query: z.object({}),
});

import { z } from 'zod';

import {
  PRODUCT_MEDIA_MAX_IMAGES,
  PRODUCT_LIGHTING_STATES,
  PRODUCT_MEDIA_VIEWS,
} from '../constants/product';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const productMediaIdSchema = z.object({
  params: z.object({ id: objectId, mediaId: objectId }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const uploadProductMediaSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      alt: z.string().trim().min(3).max(200),
      view: z.enum(PRODUCT_MEDIA_VIEWS),
      isPrimary: z
        .preprocess(
          (value) =>
            value === 'true' ? true : value === 'false' ? false : value,
          z.boolean(),
        )
        .optional(),
      lightingState: z.enum(PRODUCT_LIGHTING_STATES).optional(),
    })
    .strict(),
  query: z.object({}),
});

export const updateProductMediaSchema = z.object({
  params: z.object({ id: objectId, mediaId: objectId }),
  body: z
    .object({
      alt: z.string().trim().min(3).max(200).optional(),
      view: z.enum(PRODUCT_MEDIA_VIEWS).optional(),
      isPrimary: z.boolean().optional(),
      lightingState: z.enum(PRODUCT_LIGHTING_STATES).optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0),
  query: z.object({}),
});

export const reorderProductMediaSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      mediaIds: z
        .array(objectId)
        .max(
          PRODUCT_MEDIA_MAX_IMAGES,
          'A product cannot have more than 10 images',
        ),
    })
    .strict(),
  query: z.object({}),
});

export const artworkIdSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const signedArtworkSchema = z.object({
  params: z.object({ token: z.string().min(1).max(512) }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const artworkListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      reviewStatus: z
        .enum(['pending', 'approved', 'replacement_requested'])
        .optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      orderNumber: z.string().trim().min(1).max(40).optional(),
    })
    .refine(
      ({ from, to }) => !from || !to || from <= to,
      'from must be before to',
    ),
});

export const artworkReviewSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      decision: z.enum(['approved', 'replacement_requested']),
      note: z.string().trim().max(2000).optional(),
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

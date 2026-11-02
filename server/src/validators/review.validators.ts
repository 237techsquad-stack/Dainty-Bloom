import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), 'HTML is not allowed');
const reviewContent = z
  .object({
    rating: z.number().int().min(1).max(5),
    title: safeText(2, 160),
    body: safeText(10, 5000),
  })
  .strict();

export const productReviewListSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(200) }),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      sort: z.enum(['newest', 'highest', 'lowest']).default('newest'),
    })
    .strict(),
});

export const productReviewEligibilitySchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(200) }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const createReviewSchema = z.object({
  params: z.object({ idOrSlug: z.string().trim().min(1).max(200) }),
  body: reviewContent,
  query: z.object({}),
});

export const reviewIdSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const updateReviewSchema = z.object({
  params: z.object({ id: objectId }),
  body: reviewContent,
  query: z.object({}),
});

export const adminReviewListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      moderationState: z.enum(['pending', 'approved', 'rejected']).optional(),
      product: objectId.optional(),
      rating: z.coerce.number().int().min(1).max(5).optional(),
    })
    .strict(),
});

export const moderateReviewSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      decision: z.enum(['approved', 'rejected']),
      reason: safeText(1, 1000).optional(),
    })
    .strict()
    .superRefine((body, ctx) => {
      if (body.decision === 'rejected' && !body.reason) {
        ctx.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'A reason is required when rejecting a review',
        });
      }
    }),
  query: z.object({}),
});

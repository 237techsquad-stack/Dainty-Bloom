import { z } from 'zod';
import {
  CUSTOM_REQUEST_IMAGE_PURPOSES,
  MESSAGE_STATUSES,
  MESSAGE_TYPES,
} from '../constants/message';
import { ALL_PRODUCT_TYPES } from '../constants/product';

const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), 'HTML is not allowed');

export const messageTokenSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const createMessageSchema = z.object({
  params: z.object({}),
  body: z
    .object({
      name: safeText(1, 120),
      email: z.string().trim().email().max(254),
      orderNumber: z.string().trim().max(40).optional(),
      subject: safeText(2, 160).refine(
        (value) =>
          [...value].every((character) => {
            const code = character.charCodeAt(0);
            return code >= 32 && code !== 127;
          }),
        'Subject cannot contain control characters',
      ),
      message: safeText(5, 5000),
      submissionId: z.string().uuid().optional(),
      website: z.string().max(500).optional(),
      token: z.string().min(1).max(300),
      type: z.enum(MESSAGE_TYPES).default('general'),
      imagePurpose: z.enum(CUSTOM_REQUEST_IMAGE_PURPOSES).optional(),
      requestDetails: z.preprocess(
        (value) => {
          if (typeof value !== 'string') return value;
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return value;
          }
        },
        z
          .object({
            description: safeText(20, 2000).optional(),
            productName: safeText(1, 160).optional(),
            productType: safeText(1, 120).optional(),
            otherProductType: safeText(1, 120).optional(),
            phone: safeText(1, 40).optional(),
            approximateSize: safeText(1, 200).optional(),
            preferredColour: safeText(1, 120).optional(),
            preferredMaterial: safeText(1, 120).optional(),
            budget: safeText(1, 120).optional(),
            quantity: z.coerce.number().int().positive().optional(),
            neededByDate: z.coerce.date().optional(),
          })
          .strict()
          .optional(),
      ),
    })
    .strict()
    .superRefine((body, context) => {
      if (body.submissionId && body.type !== 'general') {
        context.addIssue({
          code: 'custom',
          path: ['submissionId'],
          message:
            'Submission identifiers are only accepted for general messages',
        });
      }
      if (
        body.type === 'general' &&
        (body.requestDetails !== undefined || body.imagePurpose !== undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['requestDetails'],
          message:
            'Custom request details are not accepted for general messages',
        });
      }
      if (
        body.type !== 'custom_3d_request' &&
        body.imagePurpose !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['imagePurpose'],
          message: 'Image purpose is only accepted for custom product requests',
        });
      }
      if (
        body.type === 'custom_3d_request' &&
        !body.requestDetails?.description
      ) {
        context.addIssue({
          code: 'custom',
          path: ['requestDetails', 'description'],
          message: 'A description is required for custom product requests',
        });
      }
      if (
        body.type === 'custom_3d_request' &&
        body.requestDetails?.productType === 'Other' &&
        !body.requestDetails.otherProductType
      ) {
        context.addIssue({
          code: 'custom',
          path: ['requestDetails', 'otherProductType'],
          message: 'Describe the other product type.',
        });
      }
    }),
  query: z.object({}),
});

export const messageListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      status: z.enum(MESSAGE_STATUSES).optional(),
      type: z.enum(MESSAGE_TYPES).optional(),
      q: z.string().trim().max(200).optional(),
      assignee: z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .optional(),
    })
    .strict(),
});

export const messageIdSchema = z.object({
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const updateMessageSchema = z.object({
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }),
  body: z
    .object({
      status: z.enum(MESSAGE_STATUSES).optional(),
      assignedTo: z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .nullable()
        .optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0),
  query: z.object({}),
});

export const replyMessageSchema = z.object({
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }),
  body: z
    .object({
      body: safeText(1, 10000),
      quotedPriceMinor: z.number().int().nonnegative().optional(),
      note: safeText(1, 2000).optional(),
    })
    .strict()
    .refine(
      ({ quotedPriceMinor, note }) =>
        note === undefined || quotedPriceMinor !== undefined,
      { message: 'A quote note requires quotedPriceMinor' },
    ),
  query: z.object({}),
});

export const customRequestTransitionSchema = z.object({
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }),
  body: z
    .object({
      status: z.enum(['under_review', 'accepted', 'declined']),
      message: safeText(1, 2000).optional(),
    })
    .strict()
    .superRefine((body, context) => {
      if (body.status === 'declined' && !body.message) {
        context.addIssue({
          code: 'custom',
          path: ['message'],
          message: 'A response is required when declining a request.',
        });
      }
    }),
  query: z.object({}),
});

const optionalSafeText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    safeText(1, max).optional(),
  );

export const createCustomOfferSchema = z.object({
  params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }),
  body: z
    .object({
      title: safeText(1, 200),
      description: safeText(20, 5000),
      categoryId: z.string().regex(/^[a-f\d]{24}$/i),
      productType: z.enum(ALL_PRODUCT_TYPES),
      size: safeText(1, 200),
      colours: optionalSafeText(300),
      materials: optionalSafeText(300),
      personalisation: optionalSafeText(500),
      additionalInstructions: optionalSafeText(1000),
      agreedQuantity: z.coerce.number().int().min(1).max(10000),
      agreedPriceMinor: z.coerce.number().int().positive().max(100_000_000),
      currency: z.literal('GBP'),
      expiresAt: z.coerce.date(),
    })
    .strict(),
  query: z.object({}),
});

import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const aboutMediaIdSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const uploadAboutMediaSchema = z.object({
  params: z.object({}),
  body: z
    .object({
      title: z.string().trim().max(160).optional(),
      description: z.string().trim().max(1000).optional(),
      altText: z.string().trim().max(300).optional(),
    })
    .strict(),
  query: z.object({}),
});

export const updateAboutMediaSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      title: z.string().trim().max(160).optional(),
      description: z.string().trim().max(1000).optional(),
      altText: z.string().trim().max(300).optional(),
      isPublished: z.boolean(),
    })
    .partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0),
  query: z.object({}),
});

export const reorderAboutMediaSchema = z.object({
  params: z.object({}),
  body: z
    .object({
      mediaIds: z.array(objectId).max(500),
    })
    .strict(),
  query: z.object({}),
});

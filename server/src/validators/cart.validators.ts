import { z } from 'zod';

import { env } from '../config/env';

const empty = z.object({}).strict();
const selectedOptionsSchema = z
  .array(
    z
      .object({
        key: z.string().trim().min(1).max(40),
        value: z.string().trim().min(1).max(120),
      })
      .strict(),
  )
  .max(20);

const cartItemSchema = z
  .object({
    productId: z.string().regex(/^[a-f\d]{24}$/i),
    selectedOptions: selectedOptionsSchema.default([]),
    quantity: z.number().int().positive().max(env.CART_MAX_QUANTITY),
    artworkId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
  })
  .strict();

export const addCartItemSchema = z.object({
  body: cartItemSchema,
  params: empty,
  query: empty,
});

export const updateCartItemSchema = z.object({
  body: z
    .object({
      quantity: z
        .number()
        .int()
        .positive()
        .max(env.CART_MAX_QUANTITY)
        .optional(),
      selectedOptions: selectedOptionsSchema.optional(),
      artworkId: z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .nullable()
        .optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one cart item field is required',
    }),
  params: z.object({ itemId: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  query: empty,
});

export const cartItemIdSchema = z.object({
  body: empty,
  params: z.object({ itemId: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  query: empty,
});

export const noInputSchema = z.object({
  body: empty,
  params: empty,
  query: empty,
});

export const wishlistProductSchema = z.object({
  body: z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  params: empty,
  query: empty,
});

export const wishlistProductIdSchema = z.object({
  body: empty,
  params: z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i) }).strict(),
  query: empty,
});

export const moveWishlistItemSchema = z.object({
  body: z
    .object({
      productId: z.string().regex(/^[a-f\d]{24}$/i),
      selectedOptions: selectedOptionsSchema.default([]),
      quantity: z.number().int().positive().max(env.CART_MAX_QUANTITY),
    })
    .strict(),
  params: empty,
  query: empty,
});

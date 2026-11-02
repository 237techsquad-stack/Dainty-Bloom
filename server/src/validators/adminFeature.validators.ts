import { z } from 'zod';

const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), 'HTML is not allowed');
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone');

export const dashboardSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      range: z.enum(['7d', '30d', '90d']).default('30d'),
      tz: timezone.optional(),
    })
    .strict(),
});

export const analyticsSalesSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      from: z.coerce.date(),
      to: z.coerce.date(),
      groupBy: z.enum(['day', 'week', 'month']).default('day'),
    })
    .strict()
    .refine((query) => query.from < query.to, 'from must be before to'),
});

export const analyticsCustomersSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      range: z.enum(['7d', '30d', '90d']).default('30d'),
      groupBy: z.enum(['day', 'week', 'month']).default('day'),
    })
    .strict(),
});

export const adminSearchSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z.object({ q: z.string().trim().min(2).max(100) }).strict(),
});

export const staffListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .strict(),
});

export const createStaffSchema = z.object({
  params: z.object({}),
  body: z
    .object({
      name: safeText(1, 120),
      email: z.string().trim().email().max(254),
      role: z.enum(['production', 'support', 'admin']),
    })
    .strict(),
  query: z.object({}),
});

export const updateStaffSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      role: z.enum(['production', 'support', 'admin']).optional(),
      accountState: z.enum(['active', 'suspended']).optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0),
  query: z.object({}),
});

export const auditListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      actor: objectId.optional(),
      action: z.string().trim().max(120).optional(),
      targetType: z.string().trim().max(100).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    })
    .strict(),
});

export const faqListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const faqCreateSchema = z.object({
  params: z.object({}),
  body: z
    .object({
      question: safeText(3, 300),
      answer: safeText(1, 10000),
      category: safeText(1, 100),
      sortOrder: z.number().int().min(0),
      isPublished: z.boolean().default(false),
    })
    .strict(),
  query: z.object({}),
});

export const faqUpdateSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      question: safeText(3, 300).optional(),
      answer: safeText(1, 10000).optional(),
      category: safeText(1, 100).optional(),
      sortOrder: z.number().int().min(0).optional(),
      isPublished: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0),
  query: z.object({}),
});

export const faqIdSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export const newsletterSubscribeSchema = z.object({
  params: z.object({}),
  body: z
    .object({
      email: z.string().trim().email().max(254),
      consent: z.literal(true),
      source: safeText(1, 100),
    })
    .strict(),
  query: z.object({}),
});

export const newsletterUnsubscribeSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z.object({ token: z.string().trim().min(20).max(300) }).strict(),
});

export const subscriberListSchema = z.object({
  params: z.object({}),
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      status: z.enum(['subscribed', 'unsubscribed']).optional(),
      q: z.string().trim().max(200).optional(),
    })
    .strict(),
});

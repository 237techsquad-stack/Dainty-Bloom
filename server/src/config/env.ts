import { z } from 'zod';
import { loadEnvironment } from './loadEnvironment';
import { validateStripeEnvironment } from './stripeEnvValidation';

loadEnvironment();

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    CLIENT_URL: z.string().url('CLIENT_URL must be a valid URL'),
    API_PUBLIC_URL: z.string().url('API_PUBLIC_URL must be a valid URL'),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL: z
      .string()
      .regex(/^\d+[smhdw]$/)
      .default('15m'),
    REFRESH_TOKEN_TTL: z
      .string()
      .regex(/^\d+[smhdw]$/)
      .default('7d'),
    COOKIE_SECRET: z
      .string()
      .min(32, 'COOKIE_SECRET must be at least 32 characters'),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),
    TRUST_PROXY: z
      .preprocess(
        (value: unknown) => {
          if (value === 'true') return true;
          if (value === 'false' || value === '') return false;
          if (typeof value === 'string' && /^\d+$/.test(value))
            return Number(value);
          return value;
        },
        z.union([z.boolean(), z.number().int().nonnegative(), z.string()]),
      )
      .default(false),
    BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
    PASSWORD_RESET_TTL: z
      .string()
      .regex(/^\d+[smhdw]$/)
      .default('15m'),
    CART_MAX_QUANTITY: z.coerce.number().int().positive().max(1000).default(99),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
    STORAGE_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
    STORAGE_PRIVATE_DIR: z.string().min(1).default('./storage/private'),
    UPLOAD_SIGNING_SECRET: z
      .string()
      .min(32, 'UPLOAD_SIGNING_SECRET must be at least 32 characters'),
    PRODUCT_IMAGE_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(10_485_760)
      .default(10_485_760),
    PAYMENT_PROVIDER: z.enum(['manual', 'stripe']).default('manual'),
    ALLOW_LIVE_STRIPE_IN_DEVELOPMENT: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    STRIPE_SECRET_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    STRIPE_WEBHOOK_SECRET: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    STRIPE_PUBLISHABLE_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    STRIPE_CHECKOUT_EXPIRY_MINUTES: z.coerce
      .number()
      .int()
      .min(30)
      .max(1440)
      .default(30),
    UNPAID_ORDER_EXPIRY_HOURS: z.coerce.number().int().positive().default(48),
    CLOUDINARY_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .url()
        .refine((value) => value.toLowerCase().startsWith('cloudinary://'))
        .optional(),
    ),
    CLOUDINARY_CLOUD_NAME: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    CLOUDINARY_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    CLOUDINARY_API_SECRET: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    DEFAULT_CURRENCY: z.literal('GBP').default('GBP'),
    SEED_ADMIN_EMAIL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().email().optional(),
    ),
    SEED_ADMIN_PASSWORD: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(12).optional(),
    ),
    CONTACT_RECIPIENT_EMAIL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().email().optional(),
    ),
    SMTP_HOST: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    SMTP_PORT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce.number().int().min(1).max(65535).optional(),
    ),
    SMTP_SECURE: z.preprocess((value) => {
      if (value === '') return undefined;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }, z.boolean().optional()),
    SMTP_USERNAME: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    SMTP_PASSWORD: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    SMTP_FROM: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().email().optional(),
    ),
  })
  .superRefine((configuration, context) => {
    const cloudinaryConfigured =
      Boolean(configuration.CLOUDINARY_URL) ||
      Boolean(
        configuration.CLOUDINARY_CLOUD_NAME &&
        configuration.CLOUDINARY_API_KEY &&
        configuration.CLOUDINARY_API_SECRET,
      );
    if (
      configuration.STORAGE_DRIVER === 'cloudinary' &&
      !cloudinaryConfigured
    ) {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message:
          'Cloudinary credentials are required when STORAGE_DRIVER=cloudinary',
      });
    }

    const smtpPartiallyConfigured = Boolean(
      configuration.SMTP_HOST ||
      configuration.SMTP_PORT ||
      configuration.SMTP_SECURE !== undefined ||
      configuration.SMTP_USERNAME ||
      configuration.SMTP_PASSWORD ||
      configuration.SMTP_FROM,
    );

    if (
      smtpPartiallyConfigured &&
      (!configuration.SMTP_HOST ||
        !configuration.SMTP_FROM ||
        !configuration.CONTACT_RECIPIENT_EMAIL)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message:
          'SMTP_HOST, SMTP_FROM, and CONTACT_RECIPIENT_EMAIL are required together to enable contact email delivery',
      });
    }

    if (
      Boolean(configuration.SMTP_USERNAME) !==
      Boolean(configuration.SMTP_PASSWORD)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_USERNAME'],
        message: 'SMTP_USERNAME and SMTP_PASSWORD must be configured together',
      });
    }

    if (
      configuration.SMTP_HOST?.toLowerCase() === 'smtp.gmail.com' &&
      (!configuration.SMTP_USERNAME || !configuration.SMTP_PASSWORD)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_USERNAME'],
        message:
          'SMTP_USERNAME and SMTP_PASSWORD are required when using Gmail SMTP',
      });
    }

    if (
      configuration.SMTP_HOST?.toLowerCase() === 'smtp.gmail.com' &&
      configuration.SMTP_FROM?.toLowerCase() !== 'info@daintybloome.com'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_FROM'],
        message:
          'SMTP_FROM must be info@daintybloome.com when using Gmail SMTP',
      });
    }

    if (configuration.SMTP_HOST?.toLowerCase() === 'smtp.gmail.com') {
      const port = configuration.SMTP_PORT ?? 587;
      const secure = configuration.SMTP_SECURE ?? port === 465;
      if (!((port === 587 && !secure) || (port === 465 && secure))) {
        context.addIssue({
          code: 'custom',
          path: ['SMTP_PORT'],
          message:
            'Gmail SMTP must use port 587 with STARTTLS or port 465 with implicit TLS',
        });
      }
    }

    for (const issue of validateStripeEnvironment({
      paymentProvider: configuration.PAYMENT_PROVIDER,
      nodeEnv: configuration.NODE_ENV,
      allowLiveModeInDevelopment:
        configuration.ALLOW_LIVE_STRIPE_IN_DEVELOPMENT,
      requireStripeProvider: configuration.NODE_ENV === 'production',
      secretKey: configuration.STRIPE_SECRET_KEY,
      publishableKey: configuration.STRIPE_PUBLISHABLE_KEY,
      webhookSecret: configuration.STRIPE_WEBHOOK_SECRET,
    })) {
      context.addIssue({
        code: 'custom',
        path: [issue.path],
        message: issue.message,
      });
    }
  });

const envResult = envSchema.safeParse(process.env);

if (envResult.success) {
  const hasCloudinaryUrl = Boolean(envResult.data.CLOUDINARY_URL);
  const cloudinaryValues = [
    envResult.data.CLOUDINARY_CLOUD_NAME,
    envResult.data.CLOUDINARY_API_KEY,
    envResult.data.CLOUDINARY_API_SECRET,
  ];
  if (
    !hasCloudinaryUrl &&
    cloudinaryValues.some(Boolean) &&
    cloudinaryValues.some((value) => !value)
  ) {
    console.error(
      'Invalid environment configuration:\n- Configure CLOUDINARY_URL or all three CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET values.',
    );
    process.exit(1);
  }
}

if (!envResult.success) {
  console.error('Invalid environment configuration:');
  for (const issue of envResult.error.issues) {
    console.error(`- ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = envResult.data;

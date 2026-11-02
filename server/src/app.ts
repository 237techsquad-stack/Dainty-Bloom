import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config/env';
import { csrfGuard } from './middleware/csrfGuard';
import { createRateLimiter as rateLimit } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { adminRoutes } from './routes/adminRoutes';
import { authRoutes } from './routes/authRoutes';
import { catalogRoutes } from './routes/catalogRoutes';
import { cartRoutes } from './routes/cartRoutes';
import { healthRoutes } from './routes/healthRoutes';
import { wishlistRoutes } from './routes/wishlistRoutes';
import { artworkRoutes } from './routes/artworkRoutes';
import { settingsRoutes } from './routes/settingsRoutes';
import { checkoutRoutes, orderRoutes } from './routes/orderRoutes';
import { messageRoutes } from './routes/messageRoutes';
import { productReviewRoutes, reviewRoutes } from './routes/reviewRoutes';
import {
  newsletterRoutes,
  publicFaqRoutes,
} from './routes/adminOperationsRoutes';
import { logger } from './utils/logger';
import { AppError } from './utils/AppError';
import { stripeWebhookRoutes } from './routes/stripeWebhookRoutes';
import { aboutMediaRoutes } from './routes/aboutMediaRoutes';

export const app = express();
app.set('trust proxy', env.TRUST_PROXY);

app.use(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json', limit: '1mb' }),
  stripeWebhookRoutes,
);
app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(env.COOKIE_SECRET));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
);
app.use(
  morgan(
    (tokens, req, res) => {
      const requestUrl = tokens.url(req, res) ?? '/';
      const requestPath = requestUrl
        .split('?')[0]
        .replace(
          /^\/api\/artwork\/signed\/[^/]+/,
          '/api/artwork/signed/[redacted]',
        );
      return [
        tokens.method(req, res),
        requestPath,
        tokens.status(req, res),
        tokens['response-time'](req, res),
      ].join(' ');
    },
    {
      stream: {
        write: (message: string): void => {
          logger.info({ request: message.trim() }, 'HTTP request');
        },
      },
    },
  ),
);

app.use('/api', csrfGuard);
app.use('/api/health', healthRoutes);
app.use('/api', catalogRoutes);
app.use('/api/about', aboutMediaRoutes);
app.use('/api', productReviewRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/artwork', artworkRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/faqs', publicFaqRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.use((_req, _res, next): void => {
  next(new AppError('Route not found', 404, 'NOT_FOUND'));
});

app.use(errorHandler);

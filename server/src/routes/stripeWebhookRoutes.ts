import { Router } from 'express';

import { stripeWebhook } from '../controllers/payment.controller';

export const stripeWebhookRoutes = Router();
stripeWebhookRoutes.post('/', stripeWebhook);

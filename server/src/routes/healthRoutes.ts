import { Router } from 'express';

import { getHealth } from '../controllers/healthController';
import { getReadiness } from '../controllers/healthController';

export const healthRoutes = Router();

healthRoutes.get('/', getHealth);
healthRoutes.get('/ready', getReadiness);

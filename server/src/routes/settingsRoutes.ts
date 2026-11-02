import { Router } from 'express';

import {
  adminSettings,
  patchSettings,
  publicSettings,
} from '../controllers/settings.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import { updateSettingsSchema } from '../validators/settings.validators';

export const settingsRoutes = Router();
export const adminSettingsRoutes = Router();

settingsRoutes.get('/public', publicSettings);
adminSettingsRoutes.use(authenticate, requirePermission('settings:write'));
adminSettingsRoutes.get('/', adminSettings);
adminSettingsRoutes.patch('/', validate(updateSettingsSchema), patchSettings);

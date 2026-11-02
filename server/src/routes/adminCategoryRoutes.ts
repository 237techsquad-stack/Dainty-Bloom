import { Router } from 'express';

import {
  create,
  list,
  remove,
  update,
} from '../controllers/adminCategory.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  categoryIdSchema,
  createCategorySchema,
  updateCategorySchema,
} from '../validators/catalog.validators';

export const adminCategoryRoutes = Router();

adminCategoryRoutes.use(authenticate, requirePermission('products:write'));
adminCategoryRoutes.get('/', list);
adminCategoryRoutes.post('/', validate(createCategorySchema), create);
adminCategoryRoutes.patch('/:id', validate(updateCategorySchema), update);
adminCategoryRoutes.delete('/:id', validate(categoryIdSchema), remove);

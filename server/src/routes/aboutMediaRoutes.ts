import { Router } from 'express';

import { getPublicAboutMedia } from '../controllers/aboutMedia.controller';

export const aboutMediaRoutes = Router();

aboutMediaRoutes.get('/media', getPublicAboutMedia);

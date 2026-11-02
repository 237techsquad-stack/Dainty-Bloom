
import pino from 'pino';

import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.authorization',
      '*.cookie',
      '*.email',
      '*.ipHash',
      '*.password',
      '*.recipient',
      '*.resetLink',
      '*.secret',
      '*.storageKey',
      '*.token',
      'err.message',
      'err.stack',
    ],
    censor: '[REDACTED]',
  },
});

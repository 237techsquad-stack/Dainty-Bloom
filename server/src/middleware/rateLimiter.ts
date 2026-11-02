import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

export function createRateLimiter(
  options: Parameters<typeof rateLimit>[0],
): RequestHandler {
  const middleware = rateLimit(options);
  return Object.assign(middleware, {
    routeProtection: { kind: 'rateLimit' as const },
  });
}

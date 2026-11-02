import type { Request, RequestHandler, Response, NextFunction } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next): void => {
    void handler(req, res, next).catch(next);
  };
}

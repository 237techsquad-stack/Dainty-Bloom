import type { RequestHandler } from 'express';
import mongoose from 'mongoose';

export const getHealth: RequestHandler = (_req, res): void => {
  res.json({ success: true });
};

export const getReadiness: RequestHandler = (_req, res): void => {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      success: false,
      error: { code: 'NOT_READY', message: 'Service is not ready', details: null },
    });
    return;
  }
  res.json({ success: true, data: { ready: true } });
};

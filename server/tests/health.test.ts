import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '../src/app';

describe('GET /api/health', () => {
  it('returns a successful health response', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });
});

import { describe, expect, it } from 'vitest';
import { buildApiEndpoint, getApiOrigin } from './apiUrl';

describe('backend API URL configuration', () => {
  it('uses localhost only for local development', () => {
    expect(getApiOrigin({ NODE_ENV: 'development' })).toBe(
      'http://localhost:5000',
    );
    expect(() => getApiOrigin({ NODE_ENV: 'production' })).toThrow(
      'API_URL is required outside local development',
    );
    expect(() =>
      getApiOrigin({ NODE_ENV: 'development', VERCEL_ENV: 'preview' }),
    ).toThrow('API_URL is required outside local development');
  });

  it('validates and normalizes a backend origin', () => {
    expect(
      getApiOrigin({
        NODE_ENV: 'production',
        API_URL: 'https://backend.example/',
      }),
    ).toBe('https://backend.example');
  });

  it('rejects API_URL paths, including a duplicated /api suffix', () => {
    expect(() =>
      getApiOrigin({
        NODE_ENV: 'production',
        API_URL: 'https://backend.example/api',
      }),
    ).toThrow('do not include /api');
    expect(() =>
      getApiOrigin({
        NODE_ENV: 'production',
        API_URL: 'https://backend.example/v1',
      }),
    ).toThrow('without a path');
  });

  it('appends /api exactly once to server-side endpoints', () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      API_URL: 'https://backend.example/',
    };
    expect(buildApiEndpoint('/products', environment)).toBe(
      'https://backend.example/api/products',
    );
    expect(() => buildApiEndpoint('/api/products', environment)).toThrow(
      'below the /api prefix',
    );
  });

  it('allows explicit loopback URLs for isolated production build checks', () => {
    expect(
      getApiOrigin({
        NODE_ENV: 'production',
        API_URL: 'http://127.0.0.1:1',
      }),
    ).toBe('http://127.0.0.1:1');
  });

  it('requires HTTPS for non-loopback deployment API origins', () => {
    expect(() =>
      getApiOrigin({
        NODE_ENV: 'production',
        API_URL: 'http://backend.example',
      }),
    ).toThrow('API_URL must use HTTPS');
  });
});

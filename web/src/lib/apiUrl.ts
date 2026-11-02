const LOCAL_API_ORIGIN = 'http://localhost:5000';

export function getApiOrigin(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.API_URL?.trim();
  const isDeployment =
    environment.VERCEL_ENV === 'preview' ||
    environment.VERCEL_ENV === 'production' ||
    environment.NODE_ENV === 'production';

  if (!configured) {
    if (!isDeployment && environment.NODE_ENV === 'development') {
      return LOCAL_API_ORIGIN;
    }
    throw new Error(
      'API_URL is required outside local development. Set it to the backend origin without a path or /api suffix.',
    );
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(
      'API_URL must be an absolute HTTP(S) backend origin without a path, query, or fragment.',
    );
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (normalizedPath !== '' && normalizedPath !== '/') ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'API_URL must be an absolute HTTP(S) backend origin without a path, query, or fragment; do not include /api.',
    );
  }

  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  if (isDeployment && url.protocol !== 'https:' && !isLoopback) {
    throw new Error(
      'API_URL must use HTTPS in Preview and Production except for explicit loopback build-isolation URLs.',
    );
  }

  return url.origin;
}

export function buildApiEndpoint(
  path: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (!path.startsWith('/') || path === '/api' || path.startsWith('/api/')) {
    throw new Error('API endpoint paths must start below the /api prefix.');
  }
  return `${getApiOrigin(environment)}/api${path}`;
}

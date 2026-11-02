import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { getApiOrigin } from './src/lib/apiUrl';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${getApiOrigin()}/api/:path*`,
      },
    ];
  },
  turbopack: {
    root: projectRoot,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;

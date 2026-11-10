import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: '/investment-tech-tree',
  // Slim self-contained server for the dockerized deploy (kg/ stack)
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Ensure API routes work properly
  async rewrites() {
    return [
      {
        source: '/investment-tech-tree/api/:path*',
        destination: '/api/:path*',
      },
    ];
  },
};

export default nextConfig;
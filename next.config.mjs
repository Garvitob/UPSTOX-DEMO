/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_DIST_DIR lets a verification build run beside a live dev server without sharing .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // No next/image use: keep the Image Optimization API off (GHSA-2xp9-vwfh-vxw4 on Next 14).
  images: { unoptimized: true },
  experimental: {
    // ws + protobufjs run only in route handlers (server). Keep them out of the bundle.
    serverComponentsExternalPackages: ['ws', 'protobufjs'],
    // Route handlers read these at runtime (instrument keys, watchlist, cached account data, feed proto).
    // Tracing them keeps serverless deployments (Vercel) working.
    outputFileTracingIncludes: {
      '/api/**/*': ['./data/*.json', './data/cache/*.json', './src/server/proto/*.proto'],
    },
  },
};

export default nextConfig;

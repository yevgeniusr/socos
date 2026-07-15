// @ts-check

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(__dirname, '../..'),
  transpilePackages: ['@socos/shared'],
  // Nginx handles all routing - use relative paths
  // These rewrites are for SSR and internal Next.js routing
  async rewrites() {
    return [
      // API routes are handled by nginx reverse proxy on same host
      // No rewrites needed - client goes to /api/* which nginx routes to NestJS
    ]
  },
  // Suppress turbopack warning for Next.js 14 compatibility
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig

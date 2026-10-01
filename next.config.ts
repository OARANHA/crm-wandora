import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

/** Performance budget (EPIC-12 §S-12.05):
 *  - LCP < 2.5s p75
 *  - CLS < 0.1 p75
 *  - INP < 200ms p75
 *  - Initial bundle /app/inbox < 250KB gzipped
 */
const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**",
      "./node_modules/.pnpm/@napi-rs+canvas@*/node_modules/@napi-rs/canvas/**",
      "./node_modules/.pnpm/@napi-rs+canvas-*/node_modules/@napi-rs/*/*.node",
      "./node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/**",
    ],
  },
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react", "lucide-react", "date-fns"],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
  async headers() {
    return [
      {
        source: "/notify-sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=(), notifications=(self)",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "automatik-labs",
  project: "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  useRunAfterProductionCompileHook: Boolean(process.env.SENTRY_AUTH_TOKEN),
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});

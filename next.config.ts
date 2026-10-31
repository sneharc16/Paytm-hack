import type { NextConfig } from "next";

// Application-wide security headers across both Consumer (/app, /live, /demo, /merchant, /ops) and Business (/business)
// surfaces: strict CSP with blob/data audio for TTS, anti-framing (DENY), HSTS, Permissions-Policy, and no-store on APIs.
const dev = process.env.NODE_ENV !== "production";

function securityHeaders(opts: { allowSameOriginMic: boolean }) {
  return [
    { key: "Content-Security-Policy", value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      `connect-src 'self'${dev ? " ws: wss:" : ""}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ") },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: `camera=(), microphone=${opts.allowSameOriginMic ? "(self)" : "()"}, geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)`,
    },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}

const appHeaders = securityHeaders({ allowSameOriginMic: true });
const businessHeaders = securityHeaders({ allowSameOriginMic: false });

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: appHeaders },
      { source: "/business/:path*", headers: businessHeaders },
      { source: "/business", headers: businessHeaders },
      { source: "/api/:path*", headers: [...appHeaders, { key: "Cache-Control", value: "no-store" }] },
      { source: "/api/v1/:path*", headers: [...businessHeaders, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

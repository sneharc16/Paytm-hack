import type { NextConfig } from "next";

// Security headers for Pakka for Business only (the consumer surfaces are unchanged). No framing, so nobody can
// overlay the approval screen; scripts, styles and connections only from this origin.
const dev = process.env.NODE_ENV !== "production";
const businessHeaders = [
  { key: "Content-Security-Policy", value: [
    "default-src 'self'", `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:", `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join("; ") },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/business/:path*", headers: businessHeaders },
      { source: "/business", headers: businessHeaders },
      { source: "/api/v1/:path*", headers: [...businessHeaders, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
  /* config options here */
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

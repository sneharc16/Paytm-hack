// Shared server security primitives: non-spoofable IP extraction, bounded rate limiters, constant-time bearer
// verification, strict origin/Sec-Fetch-Site CSRF guards, prototype-safe JSON parsing, path containment, and SSRF defense.
import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import path from "node:path";

const SAFE_IP_CHARS = /^[0-9a-fA-F:.,[\]%]+$/;

function sanitizeIp(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s || s.length > 64 || !SAFE_IP_CHARS.test(s)) return null;
  return s;
}

/**
 * Extract client IP without trusting spoofable leftmost X-Forwarded-For values.
 * Uses platform-verified headers first; only reads X-Forwarded-For when TRUST_PROXY=1 (taking the rightmost hop).
 */
export function clientIp(req: Request): string {
  for (const h of ["cf-connecting-ip", "x-real-ip", "x-vercel-forwarded-for"]) {
    const val = req.headers.get(h)?.split(",")[0];
    const clean = sanitizeIp(val);
    if (clean) return clean;
  }
  if (process.env.TRUST_PROXY === "1") {
    const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => sanitizeIp(s)).filter((s): s is string => !!s);
    if (hops.length) return hops.at(-1)!;
  }
  return "local";
}

/** Memory-bounded fixed-window rate limiter. Evicts expired and oldest entries so attackers cannot exhaust heap memory. */
export class BoundedRateLimiter {
  private buckets = new Map<string, { n: number; reset: number }>();
  constructor(private readonly maxEntries = 4096, private readonly windowMs = 60_000) {}

  limited(key: string, maxPerWindow: number, now = Date.now()): boolean {
    const cur = this.buckets.get(key);
    if (cur && cur.reset > now) {
      return ++cur.n > maxPerWindow;
    }
    this.buckets.delete(key);
    if (this.buckets.size >= this.maxEntries) {
      for (const [k, v] of this.buckets) {
        if (v.reset <= now) this.buckets.delete(k);
        if (this.buckets.size < this.maxEntries) break;
      }
      if (this.buckets.size >= this.maxEntries) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
    }
    this.buckets.set(key, { n: 1, reset: now + this.windowMs });
    return maxPerWindow < 1;
  }

  clear() {
    this.buckets.clear();
  }
}

/** Constant-time string comparison using fixed-length SHA-256 digests so neither content nor length leaks via timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Verify cron Authorization header.
 * Fails CLOSED in production when CRON_SECRET is unset; compares bearer secret in constant time.
 */
export function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") ?? "";
  return constantTimeEqual(auth, `Bearer ${secret}`);
}

/**
 * Strict CSRF / origin check for cookie-authenticated browser writes (POST/PUT/PATCH/DELETE).
 * Requires Origin to be present and allowlisted, and blocks cross-site/same-site Sec-Fetch-Site requests.
 */
export function checkSameOriginWrite(req: Request, allowedOrigins: string[]): boolean {
  const fetchSite = req.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

/**
 * Origin guard for public/CLI-compatible JSON routes: rejects any browser cross-origin request while permitting
 * non-browser CLI callers that carry neither Origin nor cross-site Sec-Fetch-Site headers.
 */
export function checkNonCrossOrigin(req: Request, allowedOrigins: string[]): boolean {
  const fetchSite = req.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.includes(origin)) return false;
  return true;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** JSON.parse that strips prototype-pollution keys at every nesting depth. */
export function safeJsonParse<T = unknown>(raw: string): T {
  return JSON.parse(raw, (key, value) => (FORBIDDEN_KEYS.has(key) ? undefined : value)) as T;
}

/**
 * Stream-bounded JSON reader: rejects oversized bodies BEFORE buffering them into memory,
 * enforces application/json Content-Type when a body is present, and strips prototype-pollution keys.
 */
export async function readBoundedJson(
  req: Request,
  limit = 64 * 1024,
  opts: { requireJsonContentType?: boolean } = {},
): Promise<{ raw: string; body: unknown } | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;

  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  const requireCt = opts.requireJsonContentType ?? true;

  if (!req.body) {
    return { raw: "", body: {} };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
    }
  } catch {
    return null;
  }

  if (total === 0) return { raw: "", body: {} };
  if (requireCt && !ct.includes("application/json")) return null;

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(merged);
  try {
    return { raw, body: safeJsonParse(raw) };
  } catch {
    return null;
  }
}

/** Ensure `fileName` stays strictly inside `baseDir` with no path traversal or null bytes. */
export function safeChildPath(baseDir: string, fileName: string): string {
  if (!fileName || fileName.includes("\0") || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("INVALID_STORAGE_KEY");
  }
  const root = path.resolve(baseDir);
  const full = path.resolve(root, fileName);
  if (!full.startsWith(root + path.sep)) throw new Error("PATH_TRAVERSAL_BLOCKED");
  return full;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local & cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT & Alibaba metadata (100.100.100.200)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark network
  if (a >= 224) return true; // multicast & reserved
  return false;
}

function isPrivateIp(rawIp: string): boolean {
  const ip = rawIp.replace(/^\[|\]$/g, "").toLowerCase();
  const v = net.isIP(ip);
  if (v === 4) return isPrivateIpv4(ip);
  if (v === 6) {
    if (ip === "::" || ip === "::1" || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) return true;
    if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("ff")) return true;
    // IPv4-mapped IPv6 in dotted form (::ffff:169.254.169.254) or hex form (::ffff:a9fe:a9fe)
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateIpv4(mapped[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
      return isPrivateIpv4(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    return false;
  }
  return true;
}

/** Synchronous hostname check blocking private IPs, IPv4-mapped IPv6 metadata, localhost, and internal TLDs. */
export function isPrivateOrReservedHost(rawHost: string): boolean {
  const h = rawHost.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h === "metadata" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (net.isIP(h) !== 0) return isPrivateIp(h);
  return false;
}

/** Full outbound webhook SSRF guard: validates scheme, credentials, host, and resolves DNS in production to block DNS rebinding. */
export async function isSafeWebhookUrl(rawUrl: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (process.env.NODE_ENV !== "production") {
    return u.protocol === "https:" || u.protocol === "http:";
  }
  if (u.protocol !== "https:") return false;
  if (isPrivateOrReservedHost(u.hostname)) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0) return !isPrivateIp(host);
  try {
    const records = await lookup(host, { all: true });
    if (!records.length) return false;
    return records.every((r) => !isPrivateIp(r.address));
  } catch {
    return false;
  }
}


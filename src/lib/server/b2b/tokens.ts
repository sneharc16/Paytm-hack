// Signed, expiring tokens (sessions and passkey challenges) and secure random ids. Server only.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { b64uDecode, b64uEncode } from "@/b2b/crypto";

let cached: Buffer | null = null;
export const serverSecret = () => secret();
/** PAKKA_SESSION_SECRET in production. On a laptop a random secret is created once under the data folder. */
function secret(): Buffer {
  if (cached) return cached;
  const env = process.env.PAKKA_SESSION_SECRET;
  if (env && env.length >= 32) return (cached = Buffer.from(env));
  if (process.env.NODE_ENV === "production" && process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Set PAKKA_SESSION_SECRET (32 or more characters)");
  const dir = process.env.PAKKA_DATA_DIR ?? path.join(process.cwd(), ".pakka-data");
  const file = path.join(dir, "session-secret");
  if (!existsSync(file)) { mkdirSync(dir, { recursive: true }); writeFileSync(file, randomBytes(48).toString("hex"), { mode: 0o600 }); }
  return (cached = Buffer.from(readFileSync(file, "utf8").trim()));
}

const mac = (purpose: string, body: string) => b64uEncode(createHmac("sha256", secret()).update(`${purpose}|${body}`).digest());

export function signToken(purpose: string, payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = b64uEncode(new TextEncoder().encode(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })));
  return `${body}.${mac(purpose, body)}`;
}

export function readToken<T extends Record<string, unknown>>(purpose: string, token: string | undefined | null): T | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const want = Buffer.from(mac(purpose, body)), got = Buffer.from(sig ?? "");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64uDecode(body)!)) as T & { exp: number };
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export const randomToken = (bytes = 24) => b64uEncode(randomBytes(bytes));
export const randomId = (prefix: string, bytes = 8) => `${prefix}${randomBytes(bytes).toString("hex")}`;

// ---------- cookies ----------
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
export function cookie(name: string, value: string, maxAge: number, req: Request): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

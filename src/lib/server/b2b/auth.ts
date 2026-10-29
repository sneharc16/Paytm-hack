// Who is calling. Agents: an API key (stored only as a hash) plus an Ed25519 signature over method, path, time,
// a one-time nonce and the body, from the key registered for that agent. A stolen API key alone is useless,
// and a captured request cannot be replayed. People: a signed, HttpOnly session cookie from a passkey sign-in;
// every write they make is also passkey-signed inside the command itself.
import { requestMessage, verifySig } from "@/b2b/crypto";
import type { Agent, Person } from "@/b2b/types";
import type { Treasury } from "@/b2b/treasury";
import { sha256 } from "@/lib/hash";
import { readOrg } from "./runtime";
import { b2bStore } from "./store";
import { readCookie, readToken } from "./tokens";

export const SESSION_COOKIE = "pakka_b2b_sid";
const SKEW_MS = 5 * 60_000;

export type AuthFail = { ok: false; status: number; code: string };
export type AgentAuth = { ok: true; orgId: string; agent: Agent; t: Treasury };

/** API keys look like pk_<company suffix>_<secret>. The company is named so the right ledger can be loaded. */
export const orgFromApiKey = (key: string) => /^pk_([a-z0-9]{6,40})_[A-Za-z0-9_-]{20,}$/.exec(key)?.[1];
export const apiKeyHash = (key: string) => sha256(`PAKKA_B2B_APIKEY_V1|${key}`);

const buckets = new Map<string, { n: number; reset: number }>();
function rateOk(id: string, perMinute = 240) {
  const now = Date.now();
  const b = buckets.get(id);
  if (!b || b.reset < now) { buckets.set(id, { n: 1, reset: now + 60_000 }); return true; }
  return ++b.n <= perMinute;
}

export async function authAgent(req: Request, rawBody: string): Promise<AgentAuth | AuthFail> {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ts = req.headers.get("x-pakka-timestamp") ?? "", nonce = req.headers.get("x-pakka-nonce") ?? "", sig = req.headers.get("x-pakka-signature") ?? "";
  const suffix = orgFromApiKey(key);
  if (!suffix) return { ok: false, status: 401, code: "BAD_API_KEY" };
  const orgId = `co_${suffix}`;
  const t = await readOrg(orgId);
  const hash = apiKeyHash(key);
  const agent = t?.world.agents.find((a) => a.apiKeyHash === hash);
  if (!t || !agent) return { ok: false, status: 401, code: "BAD_API_KEY" };
  if (t.state.agentStatus.get(agent.id) !== "active") return { ok: false, status: 403, code: "AGENT_SUSPENDED" };
  if (!rateOk(agent.id)) return { ok: false, status: 429, code: "RATE_LIMITED" };
  const when = Date.parse(ts);
  if (!Number.isFinite(when) || Math.abs(Date.now() - when) > SKEW_MS) return { ok: false, status: 401, code: "STALE_REQUEST" };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return { ok: false, status: 401, code: "BAD_NONCE" };
  const url = new URL(req.url);
  const message = requestMessage({ method: req.method, path: url.pathname + url.search, timestamp: ts, nonce, body: rawBody });
  if (!verifySig(agent.publicKey, message, sig)) return { ok: false, status: 401, code: "BAD_REQUEST_SIGNATURE" };
  if (!(await b2bStore().useOnce(`req:${agent.id}:${nonce}`, new Date(when + 2 * SKEW_MS).toISOString()))) return { ok: false, status: 401, code: "REPLAYED_REQUEST" };
  return { ok: true, orgId, agent, t };
}

export type PersonAuth = { ok: true; orgId: string; person: Person; t: Treasury };
export async function authPerson(req: Request): Promise<PersonAuth | AuthFail> {
  const s = readToken<{ o: string; p: string; sid?: string }>("session", readCookie(req, SESSION_COOKIE));
  if (!s || !s.sid) return { ok: false, status: 401, code: "SIGN_IN" };
  if (await b2bStore().seen(`signout:${s.sid}`)) return { ok: false, status: 401, code: "SIGN_IN" };
  const t = await readOrg(s.o);
  const person = t?.world.people.find((p) => p.id === s.p && !p.removedAt && (p.credentials?.length ?? 0) > 0);
  if (!t || !person) return { ok: false, status: 401, code: "SIGN_IN" };
  return { ok: true, orgId: s.o, person, t };
}

/** Same-origin check for cookie-authenticated writes (SameSite=Strict already blocks most cross-site posts). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin || allowedOrigins(req).includes(origin);
}

export function allowedOrigins(req: Request): string[] {
  const env = process.env.PAKKA_ORIGINS;
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : [new URL(req.url).origin];
}

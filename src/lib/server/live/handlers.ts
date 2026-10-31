// The Pakka live API, /api/live/*. People sign up and in with a passkey (no passwords, no OTPs), get an HttpOnly
// session cookie, and every pause or cancel is confirmed with that passkey again, which stands in for the UPI PIN.
// Only money is simulated: charges go to the NPCI simulator. Everything else is the person's own data and time.
import { generateRegistrationOptions, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { b64uDecode, challengeFor, verifyWebAuthn } from "@/b2b/crypto";
import { isUiLang, baseLang, type UiLang } from "@/copy/languages";
import { passkeyVerified } from "@/engine/actions";
import { applyCommand, Command } from "@/engine/commands";
import { addMonths, AutopayInput, checkAutopay, istDate } from "@/engine/live";
import type { Lang } from "@/engine/types";
import { sha256 } from "@/lib/hash";
import { llmEnabled, runTask } from "@/llm/client";
import { SmsOut } from "@/llm/schemas";
import { errJson, guarded as guardedB2B, okJson, readJson } from "@/lib/server/b2b/http";
import { relyingParty, toSig, verifyRegistration, type AssertionJSON } from "@/lib/server/b2b/passkeys";
import { b2bStore } from "@/lib/server/b2b/store";
import { cookie, randomId, randomToken, readCookie, readToken, signToken } from "@/lib/server/b2b/tokens";
import { NotFound, nowIso, tickEveryone, withPerson } from "./runtime";
import { liveStore, type LiveDoc } from "./store";

const SESSION = "pakka_live_sid", CHAL = "pakka_live_chal";
const SESSION_TTL = 30 * 86_400;
const CONFIRM_SKEW_MS = 5 * 60_000;

/** Same as the business API's wrapper, plus a 404 for a person who no longer exists. */
const guarded = (fn: () => Promise<Response>) => guardedB2B(async () => {
  try { return await fn(); } catch (e) { if (e instanceof NotFound) return errJson(401, "SIGN_IN"); throw e; }
});

function withCookies(res: Response, cookies: string[]): Response {
  const h = new Headers(res.headers);
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(res.body, { status: res.status, headers: h });
}
const sameOrigin = (req: Request) => { const o = req.headers.get("origin"); return !o || relyingParty(req).origins.includes(o); };
const sessionCookie = (req: Request, id: string) => cookie(SESSION, signToken("live-session", { u: id, sid: randomToken(16) }, SESSION_TTL), SESSION_TTL, req);

const hits = new Map<string, { n: number; reset: number }>();
function limited(key: string, perMinute: number) {
  const now = Date.now(), b = hits.get(key);
  if (!b || b.reset < now) { hits.set(key, { n: 1, reset: now + 60_000 }); return false; }
  return ++b.n > perMinute;
}
const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

async function who(req: Request): Promise<string | null> {
  const s = readToken<{ u: string; sid: string }>("live-session", readCookie(req, SESSION));
  if (!s?.u || !s.sid) return null;
  if (await b2bStore().seen(`live-signout:${s.sid}`)) return null;
  return s.u;
}

/** The engine writes in Hindi, Hinglish or English; a regional choice is written in its base and translated. */
const engineLang = (ui: UiLang): Lang => (ui === "hi" || ui === "hinglish" || ui === "en" ? ui : baseLang(ui));

function view(r: { doc: LiveDoc; until: string; now: string }, after = 0, req?: Request) {
  const { profile } = r.doc;
  return {
    profile: { id: profile.id, name: profile.name, uiLang: profile.uiLang, lang: profile.lang, startAt: profile.startAt, passkeys: profile.credentials.map((c) => ({ id: c.id, addedAt: c.addedAt })) },
    autopays: r.doc.autopays, until: r.until, events: r.doc.events.slice(after), total: r.doc.events.length, serverTime: r.now,
    ...(req ? { rp: relyingParty(req) } : {}),
  };
}

// ---------------- sign up ----------------
const SignUp = z.object({ name: z.string().trim().min(1).max(60), lang: z.string().refine(isUiLang) });

export const signUpOptions = (req: Request) => guarded(async () => {
  if (limited(`signup:${ip(req)}`, 10)) return errJson(429, "RATE_LIMITED");
  const j = await readJson(req);
  const input = SignUp.safeParse(j?.body);
  if (!input.success) return errJson(400, "INVALID");
  const rp = relyingParty(req);
  const id = randomId("lu_", 8);
  const options = await generateRegistrationOptions({
    rpName: "Pakka", rpID: rp.rpId, userName: input.data.name, userDisplayName: input.data.name,
    userID: new TextEncoder().encode(`live:${id}`), attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" }, supportedAlgorithmIDs: [-7, -8], timeout: 120_000,
  });
  const chal = signToken("live-chal", { kind: "signup", challenge: options.challenge, id, name: input.data.name, lang: input.data.lang }, 300);
  return withCookies(okJson({ options }), [cookie(CHAL, chal, 300, req)]);
});

export const signUpFinish = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const c = readToken<{ kind: string; challenge: string; id: string; name: string; lang: UiLang }>("live-chal", readCookie(req, CHAL));
  if (!c || c.kind !== "signup") return errJson(400, "CHALLENGE_EXPIRED");
  if (!(await b2bStore().useOnce(`live-chal:${c.challenge}`, new Date(Date.now() + 600_000).toISOString()))) return errJson(400, "CHALLENGE_USED");
  const j = await readJson(req);
  const now = nowIso();
  const cred = await verifyRegistration(relyingParty(req), (j?.body as { response: RegistrationResponseJSON })?.response, c.challenge, now);
  if ("error" in cred) return errJson(400, "PASSKEY_REJECTED", cred.error);
  const doc: LiveDoc = { version: 1, profile: { id: c.id, name: c.name, lang: engineLang(c.lang), uiLang: c.lang, startAt: now, credentials: [cred] }, autopays: [], events: [] };
  await liveStore().put(doc);
  return withCookies(okJson({ id: c.id }), [sessionCookie(req, c.id), cookie(CHAL, "", 0, req)]);
});

// ---------------- sign in ----------------
const loginMessage = (nonce: string) => `PAKKA_LIVE_LOGIN_V1|${nonce}`;

export const signInOptions = (req: Request) => guarded(async () => {
  if (limited(`signin:${ip(req)}`, 20)) return errJson(429, "RATE_LIMITED");
  const rp = relyingParty(req), nonce = randomToken(24);
  const options = { challenge: challengeFor(loginMessage(nonce)), rpId: rp.rpId, userVerification: "required" as const, timeout: 120_000, allowCredentials: [] };
  return withCookies(okJson({ options }), [cookie(CHAL, signToken("live-chal", { kind: "login", nonce }, 300), 300, req)]);
});

export const signInFinish = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const c = readToken<{ kind: string; nonce: string }>("live-chal", readCookie(req, CHAL));
  if (!c || c.kind !== "login") return errJson(400, "CHALLENGE_EXPIRED");
  const a = ((await readJson(req))?.body as { assertion?: AssertionJSON })?.assertion;
  const handle = a?.response.userHandle ? new TextDecoder().decode(b64uDecode(a.response.userHandle) ?? new Uint8Array()) : "";
  const id = /^live:(lu_[a-f0-9]{16})$/.exec(handle)?.[1];
  const doc = id ? await liveStore().get(id) : null;
  if (!a || !doc) return errJson(400, "UNKNOWN_PASSKEY");
  if (!verifyWebAuthn(doc.profile.credentials.find((x) => x.id === a.id), relyingParty(req), loginMessage(c.nonce), toSig(a))) return errJson(401, "PASSKEY_REJECTED");
  if (!(await b2bStore().useOnce(`live-login:${c.nonce}`, new Date(Date.now() + 600_000).toISOString()))) return errJson(400, "CHALLENGE_USED");
  return withCookies(okJson({ id: doc.profile.id }), [sessionCookie(req, doc.profile.id), cookie(CHAL, "", 0, req)]);
});

export const signOut = (req: Request) => guarded(async () => {
  const s = readToken<{ sid?: string; exp: number }>("live-session", readCookie(req, SESSION));
  if (s?.sid) await b2bStore().useOnce(`live-signout:${s.sid}`, new Date(s.exp + 60_000).toISOString());
  return withCookies(okJson({}), [cookie(SESSION, "", 0, req)]);
});

// ---------------- the person's world ----------------
export const state = (req: Request) => guarded(async () => {
  const id = await who(req);
  if (!id) return errJson(401, "SIGN_IN");
  const after = Math.max(0, Number(new URL(req.url).searchParams.get("after") ?? 0) || 0);
  return okJson(view(await withPerson(id), after, req));
});

export const updateProfile = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const id = await who(req);
  if (!id) return errJson(401, "SIGN_IN");
  const body = z.object({ lang: z.string().refine(isUiLang).optional(), name: z.string().trim().min(1).max(60).optional() }).safeParse((await readJson(req))?.body);
  if (!body.success) return errJson(400, "INVALID");
  const r = await withPerson(id, { mutate: (doc) => {
    if (body.data.lang) { doc.profile.uiLang = body.data.lang as UiLang; doc.profile.lang = engineLang(doc.profile.uiLang); }
    if (body.data.name) doc.profile.name = body.data.name;
    return null;
  } });
  return okJson(view(r));
});

export const addAutopay = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const id = await who(req);
  if (!id) return errJson(401, "SIGN_IN");
  const input = AutopayInput.safeParse(((await readJson(req))?.body as { autopay?: unknown })?.autopay);
  if (!input.success) return errJson(400, "INVALID", input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const r = await withPerson(id, { mutate: (doc, now) => {
    if (doc.autopays.length >= 40) return "TOO_MANY";
    const bad = checkAutopay(input.data, now);
    if (bad) return bad;
    doc.autopays.push({ ...input.data, id: randomId("ap_", 6), addedAt: now });
    return null;
  } });
  return r.error ? errJson(409, r.error) : okJson(view(r));
});

/** Remove an entry typed by mistake. Only while Pakka has not acted on it; after that, pause or cancel it. */
export const removeAutopay = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const id = await who(req);
  if (!id) return errJson(401, "SIGN_IN");
  const apId = ((await readJson(req))?.body as { id?: unknown })?.id;
  if (typeof apId !== "string") return errJson(400, "INVALID");
  const r = await withPerson(id, { mutate: (doc) => {
    if (!doc.autopays.some((a) => a.id === apId)) return "NOT_FOUND";
    if (doc.events.some((e) => JSON.stringify(e).includes(apId))) return "IN_USE";
    doc.autopays = doc.autopays.filter((a) => a.id !== apId);
    return null;
  } });
  return r.error ? errJson(409, r.error) : okJson(view(r));
});

// ---------------- reading a bank SMS ----------------
const rupees = (s: string) => Number(s.replace(/,/g, ""));
/** Every number written in the message, as rupees. */
const amountsIn = (text: string) => [...text.matchAll(/(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) => rupees(m[1]));
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Date (YYYY-MM-DD) from the message: if in the future, keep as-is; if today or past, 1 month after that date. */
function dateFromSms(text: string, today: string): string | null {
  const year = (y?: string) => (y ? (y.length === 2 ? `20${y}` : y) : today.slice(0, 4));
  const maxDay = addMonths(today, 13);
  const candidates: string[] = [];
  for (const m of text.matchAll(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/g)) candidates.push(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) candidates.push(`${year(m[3])}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-,]*(\d{2,4})?\b/gi)) {
    candidates.push(`${year(m[3])}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+(\d{1,2})(?:st|nd|rd|th)?(?:[\s,]+(\d{2,4}))?\b/gi)) {
    candidates.push(`${year(m[3])}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  }
  const valid = candidates.filter((d) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d) && !Number.isNaN(Date.parse(d)) && d <= maxDay);
  const future = valid.find((d) => d > today);
  if (future) return future;
  if (valid[0]) {
    let next = addMonths(valid[0], 1);
    while (next <= today) next = addMonths(next, 1);
    return next;
  }
  return null;
}

/** The rule-based reader: the template behind the model, and the check on what the model said. */
export function readSmsByRules(text: string, today: string) {
  const amount = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text)?.[1];
  // A company name is a run of capitalised words ending in Pvt Ltd, Private Limited, Limited or Ltd.
  const legal = /((?:[A-Z][A-Za-z0-9&']*\s+){1,6}(?:Pvt\.?\s*Ltd|Private Limited|Limited|Ltd))/.exec(text)?.[1]?.trim();
  const named = /(?:for|towards)\s+([A-Z][A-Za-z0-9]*(?:\s[A-Z][A-Za-z0-9]*){0,3})\b/.exec(text)?.[1]?.trim();
  const brand = named && !(legal ?? "").startsWith(named) ? named : null;
  const nextDue = dateFromSms(text, today) ?? addMonths(today, 1);
  const interval = /\b(month|monthly|mahina|mahine)\b/i.test(text) ? "month" : /\bquarter/i.test(text) ? "quarter" : /\b(year|yearly|annual)/i.test(text) ? "year" : null;
  const kind = /\b(loan|emi)\b/i.test(text) ? "emi" : /\b(sip|mutual fund)\b/i.test(text) ? "sip" : /\binsurance\b/i.test(text) ? "insurance" : /\b(electricity|bill|gas|broadband|recharge)\b/i.test(text) ? "bill" : "subscription";
  return { brand: brand ?? null, legalName: legal ?? null, amount: amount ? Math.round(rupees(amount) * 100) : null, interval, nextDue, kind } as const;
}

export const readSms = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const id = await who(req);
  if (!id) return errJson(401, "SIGN_IN");
  if (limited(`sms:${id}`, 12)) return errJson(429, "RATE_LIMITED");
  const text = ((await readJson(req))?.body as { text?: unknown })?.text;
  if (typeof text !== "string" || !text.trim() || text.length > 800) return errJson(400, "INVALID");
  const today = istDate(nowIso());
  const rules = readSmsByRules(text, today);
  const smsDate = dateFromSms(text, today);
  let model: z.infer<typeof SmsOut> | null = null;
  if (llmEnabled()) {
    const r = await runTask("sms", { text }, { useDemoCache: false, timeoutMs: 12_000 });
    const p = r.ok ? SmsOut.safeParse(r.output) : null;
    if (p?.success && p.data.found) model = p.data;
  }
  // The model may only repeat what the message says: names must appear in it, the amount must be one of its
  // numbers, the date comes from the message (future as-is, past/today + 1 month, or 1 month after today).
  const lower = text.toLowerCase();
  const inText = (s: string | null | undefined) => (s && lower.includes(s.toLowerCase()) ? s.trim() : null);
  const amountOk = model?.amount_rupees != null && amountsIn(text).includes(model.amount_rupees);
  const dateOk = !!smsDate && !!model?.next_due && /^\d{4}-\d{2}-\d{2}$/.test(model.next_due) && model.next_due > today && model.next_due <= addMonths(today, 13) && !Number.isNaN(Date.parse(model.next_due));
  const draft = {
    brand: inText(model?.brand) ?? rules.brand,
    legalName: inText(model?.legal_name) ?? rules.legalName,
    amount: amountOk ? Math.round(model!.amount_rupees! * 100) : rules.amount,
    interval: model?.interval && (rules.interval === null || rules.interval === model.interval) ? model.interval : rules.interval,
    nextDue: smsDate ?? (dateOk ? model!.next_due! : rules.nextDue),
    kind: model?.kind ?? rules.kind,
  };
  const found = Boolean(draft.brand || draft.legalName || draft.amount || draft.interval || smsDate);
  return okJson({ draft, found, by: model ? "sarvam" : "rules" });
});

// ---------------- decisions and questions ----------------
const ALLOWED = new Set(["customer_decision", "topup_confirmed", "always_keep", "refund_answer", "question"]);
export const confirmMessage = (userId: string, cycleId: string, choice: string, ts: string) => `PAKKA_LIVE_CONFIRM_V1|${userId}|${cycleId}|${choice}|${ts}`;

export const command = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const id = await who(req);
  if (!id) return errJson(401, "SIGN_IN");
  if (limited(`cmd:${id}`, 60)) return errJson(429, "RATE_LIMITED");
  const body = (await readJson(req))?.body as { command?: unknown; confirm?: { ts?: unknown; assertion?: AssertionJSON } } | undefined;
  const parsed = Command.safeParse(body?.command);
  if (!parsed.success || !ALLOWED.has(parsed.data.kind)) return errJson(400, "INVALID");
  let cmd = parsed.data;
  if (cmd.kind === "question") cmd = { ...cmd, userId: id }; // only ever about yourself
  let pinToken: string | undefined;
  if (cmd.kind === "customer_decision" && (cmd.choice === "pause" || cmd.choice === "cancel")) {
    // The passkey stands in for the UPI PIN: it signs exactly this person, cycle, choice and time, once.
    const ts = body?.confirm?.ts, a = body?.confirm?.assertion;
    if (typeof ts !== "string" || !a || Math.abs(Date.now() - Date.parse(ts)) > CONFIRM_SKEW_MS) return errJson(401, "CONFIRM_WITH_PASSKEY");
    const doc = await liveStore().get(id);
    if (!doc || !verifyWebAuthn(doc.profile.credentials.find((x) => x.id === a.id), relyingParty(req), confirmMessage(id, cmd.cycleId, cmd.choice, ts), toSig(a))) return errJson(401, "PASSKEY_REJECTED");
    if (!(await b2bStore().useOnce(`live-confirm:${sha256(a.response.clientDataJSON)}`, new Date(Date.now() + 2 * CONFIRM_SKEW_MS).toISOString()))) return errJson(409, "REPLAYED_SIGNATURE");
    pinToken = `pk_${sha256(`${id}|${a.response.clientDataJSON}`).slice(0, 20)}`;
  }
  const c = cmd;
  const r = await withPerson(id, { act: (s, now) => {
    const cycleId = "cycleId" in c ? c.cycleId : null;
    if (cycleId && !s.idx.cycle.has(cycleId)) return { error: "UNKNOWN_CYCLE" };
    if ("mandateId" in c && !s.idx.mandate.has(c.mandateId)) return { error: "UNKNOWN_AUTOPAY" };
    if ("executionId" in c && !s.state.executions.has(c.executionId)) return { error: "UNKNOWN_CHARGE" };
    if (pinToken && c.kind === "customer_decision") { passkeyVerified(s, now, id, pinToken); return applyCommand(s, now, { ...c, pinToken }); }
    return applyCommand(s, now, c);
  } });
  const result = r.result as { error?: string } | undefined;
  if (result?.error) return errJson(404, result.error);
  return okJson({ result: r.result ?? null, ...view(r) });
});

// ---------------- cron ----------------
export const cron = (req: Request) => guarded(async () => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return errJson(401, "UNAUTHORIZED");
  return okJson(await tickEveryone());
});


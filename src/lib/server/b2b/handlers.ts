// The business API. People: /api/v1/live/* (passkey sign-in, session cookie, passkey-signed commands).
// Agents: /api/v1/agent/* (API key plus signed request). Cron: /api/v1/live/cron.
import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { acceptInvite, addPasskey, agentCommand, createOrg, OrgInput, personCommand, proposeQueue, unsignedProposals, workFor } from "@/b2b/live";
import { sha256 } from "@/lib/hash";
import { apiKeyHash, authAgent, authPerson, SESSION_COOKIE, sameOrigin, type AuthFail } from "./auth";
import { errJson, fromResult, guarded, okJson, readJson } from "./http";
import { loginOptions, registrationOptions, relyingParty, userFromHandle, verifyLogin, verifyRegistration, type AssertionJSON } from "./passkeys";
import { createOrgLedger, nowIso, readOrg, tickAll, writeOrg } from "./runtime";
import { b2bStore } from "./store";
import { cookie, randomId, randomToken, readCookie, readToken, signToken } from "./tokens";

const CHAL = "pakka_b2b_chal";
const SESSION_TTL = 8 * 3600;
const fail = (a: AuthFail) => errJson(a.status, a.code);
export const inviteTokenHash = (token: string) => sha256(`PAKKA_B2B_INVITE_V1|${token}`);

function withCookies(res: Response, cookies: string[]): Response {
  const h = new Headers(res.headers);
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(res.body, { status: res.status, headers: h });
}
const session = (req: Request, orgId: string, personId: string) => cookie(SESSION_COOKIE, signToken("session", { o: orgId, p: personId, sid: randomToken(16) }, SESSION_TTL), SESSION_TTL, req);
const clearChal = (req: Request) => cookie(CHAL, "", 0, req);

// ---------------- company creation ----------------
export const createOrgOptions = (req: Request) => guarded(async () => {
  const j = await readJson(req);
  const input = OrgInput.safeParse((j?.body as { org?: unknown })?.org);
  if (!input.success) return errJson(400, "INVALID", input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const rp = relyingParty(req);
  const orgId = randomId("co_", 5), personId = randomId("p_", 6);
  const options = await registrationOptions(rp, orgId, personId, input.data.founder.email, input.data.founder.name);
  const chal = signToken("chal", { kind: "org", challenge: options.challenge, orgId, personId, input: input.data }, 300);
  return withCookies(okJson({ options }), [cookie(CHAL, chal, 300, req)]);
});

export const createOrgFinish = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const c = readToken<{ kind: string; challenge: string; orgId: string; personId: string; input: OrgInput }>("chal", readCookie(req, CHAL));
  if (!c || c.kind !== "org") return errJson(400, "CHALLENGE_EXPIRED");
  if (!(await b2bStore().useOnce(`chal:${c.challenge}`, new Date(Date.now() + 600_000).toISOString()))) return errJson(400, "CHALLENGE_USED");
  const j = await readJson(req);
  const rp = relyingParty(req);
  const cred = await verifyRegistration(rp, (j?.body as { response: RegistrationResponseJSON })?.response, c.challenge, nowIso());
  if ("error" in cred) return errJson(400, "PASSKEY_REJECTED", cred.error);
  if (await readOrg(c.orgId)) return errJson(409, "EXISTS");
  const t = createOrg(c.orgId, c.input, c.personId, cred, rp, nowIso());
  await createOrgLedger(t);
  return withCookies(okJson({ orgId: c.orgId, personId: c.personId }), [session(req, c.orgId, c.personId), clearChal(req)]);
});

// ---------------- sign in ----------------
export const signInOptions = (req: Request) => guarded(async () => {
  const { nonce, options } = loginOptions(relyingParty(req));
  return withCookies(okJson({ options }), [cookie(CHAL, signToken("chal", { kind: "login", nonce }, 300), 300, req)]);
});

export const signInFinish = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const c = readToken<{ kind: string; nonce: string }>("chal", readCookie(req, CHAL));
  if (!c || c.kind !== "login") return errJson(400, "CHALLENGE_EXPIRED");
  const j = await readJson(req);
  const a = (j?.body as { assertion?: AssertionJSON })?.assertion;
  const who = a && userFromHandle(a);
  if (!a || !who) return errJson(400, "UNKNOWN_PASSKEY");
  const t = await readOrg(who.orgId);
  if (!t || !verifyLogin(t, who.personId, relyingParty(req), c.nonce, a)) return errJson(401, "PASSKEY_REJECTED");
  if (!(await b2bStore().useOnce(`login:${c.nonce}`, new Date(Date.now() + 600_000).toISOString()))) return errJson(400, "CHALLENGE_USED");
  return withCookies(okJson({ orgId: who.orgId, personId: who.personId }), [session(req, who.orgId, who.personId), clearChal(req)]);
});

/** Sign-out revokes the session on the server too, so a copied cookie stops working. */
export const signOut = (req: Request) => guarded(async () => {
  const s = readToken<{ sid?: string; exp: number }>("session", readCookie(req, SESSION_COOKIE));
  if (s?.sid) await b2bStore().useOnce(`signout:${s.sid}`, new Date(s.exp + 60_000).toISOString());
  return withCookies(okJson({}), [cookie(SESSION_COOKIE, "", 0, req)]);
});

// ---------------- people ----------------
export const me = (req: Request) => guarded(async () => {
  const a = await authPerson(req);
  if (!a.ok) return fail(a);
  const company = a.t.world.companies[0];
  return okJson({ orgId: a.orgId, person: { ...a.person, credentials: (a.person.credentials ?? []).map((c) => ({ id: c.id, alg: c.alg, addedAt: c.addedAt })) }, company, rp: a.t.state.rp, serverTime: nowIso() });
});

export const events = (req: Request) => guarded(async () => {
  const a = await authPerson(req);
  if (!a.ok) return fail(a);
  const after = Math.max(0, Number(new URL(req.url).searchParams.get("after") ?? 0) || 0);
  const t = await writeOrg(a.orgId, (x) => x); // let the clock run before reading
  return okJson({ events: t.events.slice(after), head: t.head, total: t.events.length, serverTime: nowIso() });
});

export const command = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const a = await authPerson(req);
  if (!a.ok) return fail(a);
  const j = await readJson(req);
  if (!j) return errJson(400, "BAD_JSON");
  const cmd = (j.body as { command?: { auth?: { webauthn?: { clientDataJSON?: string } } } }).command;
  // A passkey signature works once. Its challenge commits to the exact action and time, so a captured request
  // cannot be sent again inside the five minute window.
  const cd = cmd?.auth?.webauthn?.clientDataJSON;
  if (typeof cd !== "string") return errJson(400, "INVALID", "auth.webauthn missing");
  if (!(await b2bStore().useOnce(`act:${a.orgId}:${sha256(cd)}`, new Date(Date.now() + 15 * 60_000).toISOString()))) return errJson(409, "REPLAYED_SIGNATURE");
  const r = await writeOrg(a.orgId, (t, now) => personCommand(t, now, a.person.id, cmd));
  return fromResult(r);
});

const Prepare = z.object({ what: z.enum(["invite", "agent"]) });
/** Fresh secrets for an invite link or an agent's API key. Shown once; only their hashes go into the ledger,
 *  and only when a governor signs the matching command with a passkey. */
export const prepare = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const a = await authPerson(req);
  if (!a.ok) return fail(a);
  if (!a.person.roles.includes("governor")) return errJson(403, "NOT_A_GOVERNOR");
  const j = await readJson(req);
  const p = Prepare.safeParse(j?.body);
  if (!p.success) return errJson(400, "INVALID");
  if (p.data.what === "invite") {
    const token = randomToken(24), inviteId = randomId("inv_", 8);
    const link = `${new URL(req.url).origin}/business/live/join?org=${a.orgId}&invite=${inviteId}#${token}`;
    return okJson({ inviteId, token, tokenHash: inviteTokenHash(token), link });
  }
  const apiKey = `pk_${a.orgId.slice(3)}_${randomToken(24)}`;
  return okJson({ agentId: randomId("a_", 5), apiKey, apiKeyHash: apiKeyHash(apiKey), apiKeyPrefix: apiKey.slice(0, 16) });
});

// ---------------- invites ----------------
const InviteRef = z.object({ org: z.string().regex(/^co_[a-z0-9]+$/), invite: z.string(), token: z.string().min(20).max(100) });
export const joinOptions = (req: Request) => guarded(async () => {
  const j = await readJson(req);
  const p = InviteRef.safeParse(j?.body);
  if (!p.success) return errJson(400, "INVALID");
  const t = await readOrg(p.data.org);
  const inv = t?.state.invites.get(p.data.invite);
  if (!t || !inv || inv.status !== "open" || inv.tokenHash !== inviteTokenHash(p.data.token) || inv.expiresAt < nowIso()) return errJson(404, "INVITE_NOT_OPEN");
  const personId = randomId("p_", 6);
  const options = await registrationOptions(relyingParty(req), t.companyId, personId, inv.email, inv.name);
  const chal = signToken("chal", { kind: "invite", challenge: options.challenge, orgId: t.companyId, personId, inviteId: inv.id, tokenHash: inv.tokenHash }, 300);
  return withCookies(okJson({ options, invite: { name: inv.name, title: inv.title, roles: inv.roles, company: t.world.companies[0].brand } }), [cookie(CHAL, chal, 300, req)]);
});

export const joinFinish = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const c = readToken<{ kind: string; challenge: string; orgId: string; personId: string; inviteId: string; tokenHash: string }>("chal", readCookie(req, CHAL));
  if (!c || c.kind !== "invite") return errJson(400, "CHALLENGE_EXPIRED");
  if (!(await b2bStore().useOnce(`chal:${c.challenge}`, new Date(Date.now() + 600_000).toISOString()))) return errJson(400, "CHALLENGE_USED");
  const j = await readJson(req);
  const cred = await verifyRegistration(relyingParty(req), (j?.body as { response: RegistrationResponseJSON })?.response, c.challenge, nowIso());
  if ("error" in cred) return errJson(400, "PASSKEY_REJECTED", cred.error);
  const r = await writeOrg(c.orgId, (t, now) => acceptInvite(t, now, c.inviteId, c.tokenHash, c.personId, cred));
  if (!r.ok) return fromResult(r);
  return withCookies(okJson({ orgId: c.orgId, personId: c.personId }), [session(req, c.orgId, c.personId), clearChal(req)]);
});

// ---------------- another device ----------------
export const passkeyOptions = (req: Request) => guarded(async () => {
  const a = await authPerson(req);
  if (!a.ok) return fail(a);
  const options = await registrationOptions(relyingParty(req), a.orgId, a.person.id, a.person.email ?? a.person.name, a.person.name, a.person.credentials ?? []);
  return withCookies(okJson({ options }), [cookie(CHAL, signToken("chal", { kind: "passkey", challenge: options.challenge, orgId: a.orgId, personId: a.person.id }, 300), 300, req)]);
});

export const passkeyFinish = (req: Request) => guarded(async () => {
  if (!sameOrigin(req)) return errJson(403, "CROSS_ORIGIN");
  const a = await authPerson(req);
  if (!a.ok) return fail(a);
  const c = readToken<{ kind: string; challenge: string; orgId: string; personId: string }>("chal", readCookie(req, CHAL));
  if (!c || c.kind !== "passkey" || c.personId !== a.person.id) return errJson(400, "CHALLENGE_EXPIRED");
  const j = await readJson(req);
  const cred = await verifyRegistration(relyingParty(req), (j?.body as { response: RegistrationResponseJSON })?.response, c.challenge, nowIso());
  if ("error" in cred) return errJson(400, "PASSKEY_REJECTED", cred.error);
  return fromResult(await writeOrg(a.orgId, (t, now) => addPasskey(t, now, a.person.id, cred)));
});

// ---------------- cron ----------------
export const cron = (req: Request) => guarded(async () => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return errJson(401, "UNAUTHORIZED");
  return okJson(await tickAll());
});

// ---------------- agents ----------------
async function agentReq(req: Request) {
  const j = await readJson(req, 256 * 1024);
  if (!j) return { res: errJson(400, "BAD_JSON") } as const;
  const a = await authAgent(req, j.raw);
  if (!a.ok) return { res: fail(a) } as const;
  return { a, body: j.body } as const;
}

export const agentMe = (req: Request) => guarded(async () => {
  const r = await agentReq(req);
  if ("res" in r) return r.res!;
  const { agent, t } = r.a;
  return okJson({ agent: { id: agent.id, name: agent.name, role: agent.role, modelLabel: agent.modelLabel }, company: t.world.companies[0], sealed: t.state.sealed, policy: { version: t.state.policy.version, hash: t.state.policyHashActive }, serverTime: nowIso() });
});

export const agentWork = (req: Request) => guarded(async () => {
  const r = await agentReq(req);
  if ("res" in r) return r.res!;
  const { agent, orgId } = r.a;
  const t = await writeOrg(orgId, (x) => x);
  const role = agent.role;
  const items = role === "proposer" ? [...unsignedProposals(t), ...proposeQueue(t)] : role === "compliance" || role === "risk" ? workFor(t, role) : [];
  return okJson({ role, items, serverTime: nowIso() });
});

export const agentCommandRoute = (req: Request) => guarded(async () => {
  const r = await agentReq(req);
  if ("res" in r) return r.res!;
  const { agent, orgId } = r.a;
  return fromResult(await writeOrg(orgId, (t, now) => agentCommand(t, now, agent.id, r.body)));
});

export const agentEvents = (req: Request) => guarded(async () => {
  const r = await agentReq(req);
  if ("res" in r) return r.res!;
  const after = Math.max(0, Number(new URL(req.url).searchParams.get("after") ?? 0) || 0);
  const t = await writeOrg(r.a.orgId, (x) => x);
  return okJson({ events: t.events.slice(after), head: t.head, total: t.events.length });
});

export const agentIntent = (req: Request) => guarded(async () => {
  const r = await agentReq(req);
  if ("res" in r) return r.res!;
  const hash = new URL(req.url).searchParams.get("hash") ?? "";
  const t = await writeOrg(r.a.orgId, (x) => x);
  const it = t.state.intents.get(hash);
  if (!it) return errJson(404, "UNKNOWN_INTENT");
  return okJson({ intentHash: hash, intent: it.intent, status: it.status, attestations: it.attestations, approvals: it.approvals.map((a) => ({ personId: a.personId, role: a.role, at: a.at })), needs: it.needs, block: it.block ?? null, utr: it.utr ?? null, checks: it.checks ?? [] });
});

export const webhookKey = async () => ({ publicKey: (await import("./webhooks")).webhookPublicKey() });

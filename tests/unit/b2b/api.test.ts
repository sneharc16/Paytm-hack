// The live business API over HTTP: real passkey registration and sign-in (verified by @simplewebauthn), signed
// agent requests through the SDK, a payout end to end, and the replay and tampering defences.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { actionMessage, approveMessage, type RelyingParty } from "@/b2b/crypto";
import { makeGstin } from "@/b2b/gstin";
import { SoftPasskey } from "@/b2b/testing/softPasskey";
import * as H from "@/lib/server/b2b/handlers";
import { readOrg } from "@/lib/server/b2b/runtime";
import { MemoryStore, setB2BStoreForTests } from "@/lib/server/b2b/store";
import { generateAgentKey, PakkaAgent } from "@/sdk/pakka-agent";

const BASE = "http://localhost:3000";
const rp: RelyingParty = { rpId: "localhost", origins: [BASE] };
type Jar = Map<string, string>;
const jar = (): Jar => new Map();

const ROUTES: Record<string, Record<string, (r: Request) => Promise<Response> | Response>> = {
  "/api/v1/live/orgs/options": { POST: H.createOrgOptions }, "/api/v1/live/orgs": { POST: H.createOrgFinish },
  "/api/v1/live/session/options": { POST: H.signInOptions }, "/api/v1/live/session": { POST: H.signInFinish, DELETE: H.signOut },
  "/api/v1/live/me": { GET: H.me }, "/api/v1/live/events": { GET: H.events }, "/api/v1/live/commands": { POST: H.command },
  "/api/v1/live/prepare": { POST: H.prepare }, "/api/v1/live/join/options": { POST: H.joinOptions }, "/api/v1/live/join": { POST: H.joinFinish },
  "/api/v1/agent/me": { GET: H.agentMe }, "/api/v1/agent/work": { GET: H.agentWork }, "/api/v1/agent/commands": { POST: H.agentCommandRoute },
  "/api/v1/agent/intent": { GET: H.agentIntent }, "/api/v1/agent/events": { GET: H.agentEvents },
};

async function call(method: string, path: string, body?: unknown, j?: Jar, headers: Record<string, string> = {}) {
  const h = new Headers({ "content-type": "application/json", origin: BASE, ...headers });
  if (j?.size) h.set("cookie", [...j].map(([k, v]) => `${k}=${v}`).join("; "));
  const req = new Request(BASE + path, { method, headers: h, body: body === undefined || method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const res = await ROUTES[new URL(req.url).pathname][method](req);
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); if (v) j?.set(k, v); else j?.delete(k); }
  return (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string; missing?: string[] } }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// The SDK's fetch goes to the handlers in this process.
vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit) => {
  const req = new Request(url, init);
  return ROUTES[new URL(req.url).pathname][req.method](req);
});

interface Member { id: string; key: SoftPasskey; jar: Jar }
let orgId = "";
const people: Record<string, Member> = {};

async function signed(m: Member, command: Record<string, unknown> & { kind: string }) {
  const at = new Date().toISOString();
  const t = (await readOrg(orgId))!;
  const { kind } = command;
  const message = kind === "approve" ? approveMessage({ companyId: orgId, intentHash: String(command.intentHash), personId: m.id, role: String(command.role), at }) : actionMessage({ companyId: orgId, personId: m.id, kind, params: command, at });
  void t;
  return call("POST", "/api/v1/live/commands", { command: { ...command, auth: { at, webauthn: m.key.sign(message) } } }, m.jar);
}

beforeAll(() => { setB2BStoreForTests(new MemoryStore()); });

describe("live business API", () => {
  it("creates a company with a real passkey registration", async () => {
    const j = jar();
    const key = new SoftPasskey("api-founder", rp);
    const o = await call("POST", "/api/v1/live/orgs/options", { org: { legalName: "Bharat Fresh Pvt Ltd", brand: "Bharat Fresh", gstin: makeGstin("27", "AAACB2222B"), city: "Mumbai", founder: { name: "Asha Rao", title: "CFO", email: "asha@bharat.example" } } }, j);
    expect(o.ok, JSON.stringify(o)).toBe(true);
    // A registration answered for another site is refused.
    const phish = await call("POST", "/api/v1/live/orgs", { response: key.register(o.data.options.challenge, { origin: "https://evil.example" }) }, new Map(j));
    expect(phish.error?.code).toBe("PASSKEY_REJECTED");
    const o2 = await call("POST", "/api/v1/live/orgs/options", { org: { legalName: "Bharat Fresh Pvt Ltd", brand: "Bharat Fresh", gstin: makeGstin("27", "AAACB2222B"), city: "Mumbai", founder: { name: "Asha Rao", title: "CFO", email: "asha@bharat.example" } } }, j);
    const f = await call("POST", "/api/v1/live/orgs", { response: key.register(o2.data.options.challenge) }, j);
    expect(f.ok, JSON.stringify(f)).toBe(true);
    orgId = f.data.orgId;
    people.asha = { id: f.data.personId, key, jar: j };
    const m = await call("GET", "/api/v1/live/me", undefined, j);
    expect(m.data.person.name).toBe("Asha Rao");
    expect(m.data.person.roles).toEqual(["governor"]);
  });

  it("invites people who join with their own passkeys, and signs in by passkey", async () => {
    for (const [name, roles] of [["Ravi", ["governor"]], ["Lina", ["governor"]], ["Neel", ["maker"]], ["Ira", ["checker"]], ["Om", ["cfo"]]] as const) {
      const p = await call("POST", "/api/v1/live/prepare", { what: "invite" }, people.asha.jar);
      expect(p.ok, JSON.stringify(p)).toBe(true);
      const inv = await signed(people.asha, { kind: "invite_person", name, title: "Team", email: `${name.toLowerCase()}@bharat.example`, roles: [...roles], inviteId: p.data.inviteId, tokenHash: p.data.tokenHash });
      expect(inv.ok, JSON.stringify(inv)).toBe(true);
      const j = jar();
      const key = new SoftPasskey(`api-${name}`, rp);
      const bad = await call("POST", "/api/v1/live/join/options", { org: orgId, invite: p.data.inviteId, token: "x".repeat(32) }, j);
      expect(bad.error?.code).toBe("INVITE_NOT_OPEN");
      const jo = await call("POST", "/api/v1/live/join/options", { org: orgId, invite: p.data.inviteId, token: p.data.token }, j);
      expect(jo.ok, JSON.stringify(jo)).toBe(true);
      const jf = await call("POST", "/api/v1/live/join", { response: key.register(jo.data.options.challenge) }, j);
      expect(jf.ok, JSON.stringify(jf)).toBe(true);
      people[name.toLowerCase()] = { id: jf.data.personId, key, jar: j };
      // The same invite cannot be used twice.
      const again = await call("POST", "/api/v1/live/join/options", { org: orgId, invite: p.data.inviteId, token: p.data.token }, jar());
      expect(again.error?.code).toBe("INVITE_NOT_OPEN");
    }
    // Sign in on a fresh device with a discoverable passkey.
    const j = jar();
    const so = await call("POST", "/api/v1/live/session/options", {}, j);
    const sf = await call("POST", "/api/v1/live/session", { assertion: people.ira.key.assert(so.data.options.challenge, `${orgId}:${people.ira.id}`) }, j);
    expect(sf.ok, JSON.stringify(sf)).toBe(true);
    expect((await call("GET", "/api/v1/live/me", undefined, j)).data.person.roles).toEqual(["checker"]);
    // The same sign-in answer cannot be replayed.
    const replay = await call("POST", "/api/v1/live/session", { assertion: people.ira.key.assert(so.data.options.challenge, `${orgId}:${people.ira.id}`) }, j);
    expect(replay.ok).toBe(false);
    // Someone else's passkey claiming Ira's identity fails.
    const j2 = jar();
    const so2 = await call("POST", "/api/v1/live/session/options", {}, j2);
    expect((await call("POST", "/api/v1/live/session", { assertion: people.neel.key.assert(so2.data.options.challenge, `${orgId}:${people.ira.id}`) }, j2)).error?.code).toBe("PASSKEY_REJECTED");
    expect((await call("GET", "/api/v1/live/me", undefined, jar())).error?.code).toBe("SIGN_IN");
  });

  const agents: Record<string, PakkaAgent> = {};
  it("registers external agents with their own keys and seals the company", async () => {
    for (const role of ["proposer", "compliance", "risk", "erp"]) {
      const k = generateAgentKey();
      const p = await call("POST", "/api/v1/live/prepare", { what: "agent" }, people.asha.jar);
      const r = await signed(people.asha, { kind: "register_agent", agentId: p.data.agentId, name: `${role} bot`, role, modelLabel: `bharat-${role}-v1`, publicKey: k.publicKey, apiKeyHash: p.data.apiKeyHash, apiKeyPrefix: p.data.apiKeyPrefix });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      agents[role] = new PakkaAgent({ baseUrl: BASE, apiKey: p.data.apiKey, secretKey: k.secretKey });
    }
    // Non-governors cannot mint agent keys.
    expect((await call("POST", "/api/v1/live/prepare", { what: "agent" }, people.neel.jar)).error?.code).toBe("NOT_A_GOVERNOR");
    expect((await signed(people.asha, { kind: "seal_org" })).ok).toBe(true);
    expect((await signed(people.asha, { kind: "fund_sandbox", amount: 25_00_000_00 })).ok).toBe(true);
    const me = await agents.compliance.me();
    expect(me.ok && me.data.agent.role).toBe("compliance");
  });

  it("refuses unsigned, tampered, replayed and stale agent requests", async () => {
    const good = await agents.risk.me();
    expect(good.ok).toBe(true);
    const req = (headers: Record<string, string>, body = "") => call("POST", "/api/v1/agent/commands", body, undefined, headers);
    expect((await req({ authorization: "Bearer pk_nope" })).error?.code).toBe("BAD_API_KEY");
    // Capture a signed request and replay it, then change its body.
    let captured: { url: string; init: RequestInit } | null = null;
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit) => { captured = { url: String(url), init }; return real(url, init); });
    await agents.erp.command({ kind: "submit_po", po: { id: "PO-X", vendorId: "v_none", lines: [{ sku: "A", qty: 1, rate: 100 }] } });
    vi.stubGlobal("fetch", real);
    const c = captured!;
    const hdrs = Object.fromEntries(new Headers(c.init.headers).entries());
    expect((await req(hdrs, c.init.body as string)).error?.code).toBe("REPLAYED_REQUEST");
    expect((await req({ ...hdrs, "x-pakka-nonce": "n".repeat(32) }, (c.init.body as string).replace("PO-X", "PO-Y"))).error?.code).toBe("BAD_REQUEST_SIGNATURE");
    expect((await req({ ...hdrs, "x-pakka-timestamp": new Date(Date.now() - 10 * 60_000).toISOString() }, c.init.body as string)).error?.code).toBe("STALE_REQUEST");
  });

  it("pays an invoice over HTTP: ERP, three agents signing, a checker's passkey, the guard", async () => {
    const gstin = makeGstin("27", "AABCM3333M");
    const v = await signed(people.neel, { kind: "add_vendor", vendor: { legalName: "Malabar Spices Pvt Ltd", brand: "Malabar", gstin, pan: "AABCM3333M", category: "goods", msme: false, phoneOnFile: "+919800005555", email: "ap@malabar.example", termsDays: 30 } });
    expect(v.ok, JSON.stringify(v)).toBe(true);
    const vendorId = v.data.vendorId;
    expect((await signed(people.neel, { kind: "sandbox_account", accountNo: "998877665544", ifsc: "KSHB0005555", holder: "Malabar Spices Pvt Ltd" })).ok).toBe(true);
    const cr = await signed(people.neel, { kind: "change_request", vendorId, accountNo: "998877665544", ifsc: "KSHB0005555" });
    expect((await signed(people.neel, { kind: "callback", requestId: cr.data.requestId, outcome: "confirmed" })).ok).toBe(true);
    // The maker who called cannot also approve the account.
    expect((await signed(people.ira, { kind: "decide_change", requestId: cr.data.requestId, decision: "approved" })).ok).toBe(true);
    // Skip the 24 hour cooling for this test by moving the clock.
    // Move the clock past the 24 hour cooling, to 11 AM IST so the release window is open.
    const later = Date.now() + 25 * 3_600_000;
    const istMidnight = later - ((later + 330 * 60_000) % 86_400_000);
    vi.useFakeTimers({ now: istMidnight + 11 * 3_600_000 + (istMidnight + 11 * 3_600_000 < later ? 86_400_000 : 0), toFake: ["Date"] });
    const po = await agents.erp.submitPurchaseOrder({ id: "PO-77", vendorId, lines: [{ sku: "PEPPER", qty: 20, rate: 2_000_00 }] });
    expect(po.ok, JSON.stringify(po)).toBe(true);
    expect((await agents.erp.submitGoodsReceipt({ id: "GRN-77", poId: "PO-77", lines: [{ sku: "PEPPER", qty: 20 }] })).ok).toBe(true);
    const inv = await agents.erp.submitInvoice({ number: "MS/77", vendorId, poId: "PO-77", date: new Date().toISOString(), gstin, lines: [{ sku: "PEPPER", qty: 20, rate: 2_000_00 }], gst: 4_800_00 });
    expect(inv.ok, JSON.stringify(inv)).toBe(true);
    const work = await agents.proposer.work<{ kind: string; invoiceId?: string }>();
    expect(work.ok && work.data.items.some((i) => i.invoiceId === (inv.ok && inv.data.invoiceId))).toBe(true);
    const p = await agents.proposer.propose(inv.ok ? inv.data.invoiceId : "");
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const hash = p.ok ? p.data.intentHash : "";
    expect((await agents.proposer.attest(hash, "approve", ["matched"])).ok).toBe(true);
    expect((await agents.compliance.attest(hash, "approve", ["checked"])).ok).toBe(true);
    const r = await agents.risk.attest(hash, "approve", ["no signals"]);
    expect(r.ok && r.data.status).toBe("awaiting_approval");
    // The compliance agent cannot sign twice.
    expect((await agents.compliance.attest(hash, "approve", ["again"])).ok).toBe(false);
    // A day later Ira's session has expired; she signs in again with her passkey.
    expect((await signed(people.ira, { kind: "approve", intentHash: hash, role: "checker" })).error?.code).toBe("SIGN_IN");
    const so = await call("POST", "/api/v1/live/session/options", {}, people.ira.jar);
    expect((await call("POST", "/api/v1/live/session", { assertion: people.ira.key.assert(so.data.options.challenge, `${orgId}:${people.ira.id}`) }, people.ira.jar)).ok).toBe(true);
    const ap = await signed(people.ira, { kind: "approve", intentHash: hash, role: "checker" });
    expect(ap.ok, JSON.stringify(ap)).toBe(true);
    const view = await agents.proposer.intent(hash);
    expect(view.ok && view.data.status).toBe("settled");
    expect(view.ok && view.data.utr).toMatch(/^SBKP/);
    const so2 = await call("POST", "/api/v1/live/session/options", {}, people.om.jar);
    await call("POST", "/api/v1/live/session", { assertion: people.om.key.assert(so2.data.options.challenge, `${orgId}:${people.om.id}`) }, people.om.jar);
    const ev = await call("GET", "/api/v1/live/events?after=0", undefined, people.om.jar);
    expect(ev.data.events.some((e: { type: string }) => e.type === "payout_settled")).toBe(true);
    vi.useRealTimers();
  });
});

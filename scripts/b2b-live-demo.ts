// pnpm b2b:live-demo [url]: set up a ready-to-use live company through the public API of a running server.
// Everything goes over HTTP exactly as a browser and agents would: passkey registration for each person
// (software passkeys, saved under .pakka-data/demo-people.json so the script can act for them later), invites,
// agent registration with keys written to .pakka-agents/ for `pnpm agents run`, sealing, sandbox money, and a
// vendor whose bank account passes the name check, the callback and a checker.
//
//   pnpm b2b:live-demo                      set up a company on http://localhost:3000
//   pnpm b2b:live-demo approve [url]        sign every payout waiting for Arjun (checker) and Kiran (CFO)
//   pnpm b2b:live-demo session <person>     print a session cookie for that person (to look around in a browser)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { actionMessage, approveMessage, type RelyingParty } from "@/b2b/crypto";
import { makeGstin } from "@/b2b/gstin";
import { SoftPasskey } from "@/b2b/testing/softPasskey";
import { generateAgentKey } from "@/sdk/pakka-agent";

const args = process.argv.slice(2);
const mode = ["approve", "session"].includes(args[0]) ? args[0] : "setup";
const base = (mode === "setup" ? args[0] : args[mode === "session" ? 2 : 1]) ?? "http://localhost:3000";
const rp: RelyingParty = { rpId: new URL(base).hostname, origins: [base] };
const DATA = path.join(process.cwd(), ".pakka-data");
const PEOPLE_FILE = path.join(DATA, "demo-people.json");

type Jar = Map<string, string>;
async function call<T = any>(method: string, p: string, body?: unknown, jar?: Jar): Promise<{ ok: boolean; data: T; error?: { code: string; message: string; missing?: string[] } }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", origin: base, ...(jar?.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar?.set(k, v); else jar?.delete(k); }
  return res.json();
}
const must = <T,>(r: { ok: boolean; data: T; error?: { code: string; message: string; missing?: string[] } }, what: string): T => {
  if (!r.ok) throw new Error(`${what}: ${r.error?.code} ${r.error?.message ?? ""} ${r.error?.missing?.join(", ") ?? ""}`);
  return r.data;
};

interface Member { name: string; id: string; seed: string; jar: Jar }
async function act(orgId: string, m: Member, command: Record<string, unknown> & { kind: string }) {
  const key = new SoftPasskey(m.seed, rp);
  const at = new Date().toISOString();
  const message = command.kind === "approve" ? approveMessage({ companyId: orgId, intentHash: String(command.intentHash), personId: m.id, role: String(command.role), at }) : actionMessage({ companyId: orgId, personId: m.id, kind: command.kind, params: command, at });
  return call("POST", "/api/v1/live/commands", { command: { ...command, auth: { at, webauthn: key.sign(message) } } }, m.jar);
}
async function signIn(orgId: string, m: Member) {
  const o = must(await call<{ options: { challenge: string } }>("POST", "/api/v1/live/session/options", {}, m.jar), "sign-in options");
  must(await call("POST", "/api/v1/live/session", { assertion: new SoftPasskey(m.seed, rp).assert(o.options.challenge, `${orgId}:${m.id}`) }, m.jar), `sign in ${m.name}`);
}

async function setup() {
  const run = Date.now().toString(36);
  const founder: Member = { name: "Meera Iyer", id: "", seed: `demo-${run}-meera`, jar: new Map() };
  const org = { legalName: "Saanjh Distributors Pvt Ltd", brand: "Saanjh", gstin: makeGstin("27", "AAKCS4821M"), city: "Pune", founder: { name: founder.name, title: "Chief financial officer", email: "meera@saanjh.example" } };
  const o = must(await call<{ options: { challenge: string } }>("POST", "/api/v1/live/orgs/options", { org }, founder.jar), "company options");
  const created = must(await call<{ orgId: string; personId: string }>("POST", "/api/v1/live/orgs", { response: new SoftPasskey(founder.seed, rp).register(o.options.challenge) }, founder.jar), "create company");
  const orgId = created.orgId;
  founder.id = created.personId;
  console.log(`Company ${orgId} created; Meera registered a passkey`);
  must(await act(orgId, founder, { kind: "set_initial_policy", changes: { coolingHoursNew: 0, coolingHoursChanged: 0, releaseStartMin: 0, releaseEndMin: 1440 } }), "starting rules");

  const members: Record<string, Member> = { meera: founder };
  for (const [key, name, title, roles] of [["vikram", "Vikram Joshi", "Managing director", ["governor"]], ["sana", "Sana Qureshi", "Independent director", ["governor"]], ["neha", "Neha Kulkarni", "Accounts payable lead", ["maker"]], ["arjun", "Arjun Mehta", "Financial controller", ["checker"]], ["kiran", "Kiran Rao", "Finance head", ["cfo"]]] as const) {
    const p = must(await call<{ inviteId: string; token: string; tokenHash: string }>("POST", "/api/v1/live/prepare", { what: "invite" }, founder.jar), "prepare invite");
    must(await act(orgId, founder, { kind: "invite_person", name, title, email: `${key}@saanjh.example`, roles: [...roles], inviteId: p.inviteId, tokenHash: p.tokenHash }), `invite ${name}`);
    const m: Member = { name, id: "", seed: `demo-${run}-${key}`, jar: new Map() };
    const jo = must(await call<{ options: { challenge: string } }>("POST", "/api/v1/live/join/options", { org: orgId, invite: p.inviteId, token: p.token }, m.jar), "join options");
    m.id = must(await call<{ personId: string }>("POST", "/api/v1/live/join", { response: new SoftPasskey(m.seed, rp).register(jo.options.challenge) }, m.jar), `join ${name}`).personId;
    members[key] = m;
    console.log(`${name} joined as ${roles.join(", ")}`);
  }

  mkdirSync(path.join(process.cwd(), ".pakka-agents"), { recursive: true });
  for (const [name, role, model] of [["payables", "proposer", "saanjh-ap-proposer-v1"], ["compliance", "compliance", "saanjh-ap-compliance-v1"], ["risk", "risk", "saanjh-ap-risk-v1"], ["erp", "erp", "saanjh-erp-connector-v1"]] as const) {
    const k = generateAgentKey();
    const p = must(await call<{ agentId: string; apiKey: string; apiKeyHash: string; apiKeyPrefix: string }>("POST", "/api/v1/live/prepare", { what: "agent" }, founder.jar), "prepare agent");
    must(await act(orgId, founder, { kind: "register_agent", agentId: p.agentId, name: `${name[0].toUpperCase()}${name.slice(1)} agent`, role, modelLabel: model, publicKey: k.publicKey, apiKeyHash: p.apiKeyHash, apiKeyPrefix: p.apiKeyPrefix }), `register ${name}`);
    writeFileSync(path.join(process.cwd(), ".pakka-agents", `${name}.json`), JSON.stringify({ name, ...k, apiKey: p.apiKey, baseUrl: base }, null, 2), { mode: 0o600 });
    console.log(`${name} agent registered; key saved to .pakka-agents/${name}.json`);
  }
  must(await act(orgId, founder, { kind: "seal_org" }), "seal");
  must(await act(orgId, founder, { kind: "fund_sandbox", amount: 50_00_000_00 }), "fund");
  console.log("Setup sealed; ₹50,00,000 of sandbox money added");

  const vendorPan = "AABCM7788D";
  const vendorGstin = makeGstin("27", vendorPan);
  must(await act(orgId, founder, { kind: "sandbox_account", accountNo: "602211004455", ifsc: "NRMB0004321", holder: "Meghdoot Packaging Pvt Ltd" }), "vendor account");
  must(await act(orgId, founder, { kind: "sandbox_account", accountNo: "50200077341190", ifsc: "DCUB0004417", holder: "R K Enterprises" }), "fraud account");
  const v = must(await act(orgId, members.neha, { kind: "add_vendor", vendor: { legalName: "Meghdoot Packaging Pvt Ltd", brand: "Meghdoot", gstin: vendorGstin, pan: vendorPan, category: "goods", msme: true, phoneOnFile: "+919820001234", email: "accounts@meghdootpackaging.example", termsDays: 30 } }), "add vendor") as { vendorId: string };
  const cr = must(await act(orgId, members.neha, { kind: "change_request", vendorId: v.vendorId, accountNo: "602211004455", ifsc: "NRMB0004321" }), "bank request") as { requestId: string };
  must(await act(orgId, members.neha, { kind: "callback", requestId: cr.requestId, outcome: "confirmed" }), "callback");
  must(await act(orgId, members.arjun, { kind: "decide_change", requestId: cr.requestId, decision: "approved" }), "approve account");
  console.log(`Vendor Meghdoot (${v.vendorId}) added; its account passed the name check, the callback and the checker`);

  mkdirSync(DATA, { recursive: true });
  writeFileSync(PEOPLE_FILE, JSON.stringify({ base, orgId, vendorId: v.vendorId, vendorGstin, members: Object.fromEntries(Object.entries(members).map(([k, m]) => [k, { name: m.name, id: m.id, seed: m.seed }])) }, null, 2), { mode: 0o600 });
  console.log(`\nReady. Next:\n  pnpm agents run\n  pnpm agents erp-demo erp ${v.vendorId} --gstin=${vendorGstin}\n  pnpm agents erp-demo erp ${v.vendorId} --gstin=${vendorGstin} --phish\n  pnpm b2b:live-demo approve`);
}

async function approveAll() {
  const saved = JSON.parse(readFileSync(PEOPLE_FILE, "utf8"));
  const members: Record<string, Member> = Object.fromEntries(Object.entries(saved.members as Record<string, Omit<Member, "jar">>).map(([k, m]) => [k, { ...m, jar: new Map() }]));
  for (const k of ["arjun", "kiran"]) await signIn(saved.orgId, members[k]);
  const ev = must(await call<{ events: { type: string; payload: Record<string, any> }[] }>("GET", "/api/v1/live/events?after=0", undefined, members.arjun.jar), "events"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const waiting = new Map<string, string[]>();
  for (const e of ev.events) {
    if (e.type === "approval_needed") waiting.set(e.payload.intentHash, e.payload.needs);
    if (["payout_submitted", "approval_declined", "intent_expired", "guard_blocked"].includes(e.type) && e.type !== "guard_blocked") waiting.delete(e.payload.intentHash);
  }
  if (!waiting.size) console.log("Nothing waiting for a person.");
  for (const [hash, needs] of waiting) {
    for (const role of needs) {
      const m = role === "checker" ? members.arjun : members.kiran;
      const r = await act(saved.orgId, m, { kind: "approve", intentHash: hash, role });
      console.log(`${m.name} signed ${hash.slice(0, 10)} as ${role}: ${r.ok ? JSON.stringify(r.data) : r.error?.code}`);
    }
  }
}

async function session() {
  const saved = JSON.parse(readFileSync(PEOPLE_FILE, "utf8"));
  const m: Member = { ...saved.members[args[1]], jar: new Map() };
  await signIn(saved.orgId, m);
  console.log(`pakka_b2b_sid=${m.jar.get("pakka_b2b_sid")}`);
}

void (mode === "approve" ? approveAll() : mode === "session" ? session() : setup()).catch((e) => { console.error(String(e)); process.exit(1); });

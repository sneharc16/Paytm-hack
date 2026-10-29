// src/b2b/live.ts: the live command layer. Real actors, real signatures, wall-clock time; only money is simulated.
//   Agents (external, authenticated by API key plus a signed request at the HTTP layer) submit orders, goods
//   receipts and invoices, propose payouts and send signed attestations. Each attestation's signature is checked
//   here before it is recorded, and again by the guard before money moves.
//   People sign every write with a passkey. The signature covers the exact action, its parameters and its time,
//   and is verified here; approvals are kept in the receipt so the guard re-verifies them itself.
// Pure: no I/O, no randomness, no clock. Ids, tokens and API keys are made by the caller and passed in as hashes.
import { z } from "zod";
import { buildIntent } from "./agents";
import { addMin, hoursBetween } from "./clock";
import {
  actionMessage, approveMessage, attestMessage, canonical, dhash, governMessage, verifyPersonSig, verifySig, type PasskeyCredential, type RelyingParty, type WebAuthnSig,
} from "./crypto";
import { isGstin, isPan } from "./gstin";
import { intentHash } from "./intent";
import { diffPolicy, GOVERNANCE_THRESHOLD, isLoosening, policyHash, TIMELOCK_HOURS, type Policy } from "./policy";
import { PolicyChanges } from "./commands";
import type { B2BRuleId } from "./rules";
import { Treasury } from "./treasury";
import type { Agent, AgentRole, BusinessWorld, ClientRole, Company, Invoice, ISO, Person, PersonRole } from "./types";
import { GST_BPS } from "./world";

export interface LiveResult { ok: boolean; reason?: string; data?: Record<string, unknown> }
const ok = (data?: Record<string, unknown>): LiveResult => ({ ok: true, data });

// ---------------- genesis ----------------

export function emptyWorld(company: Company): BusinessWorld {
  return { seed: `live-${company.id}`, companies: [company], vendors: [], beneficiaries: [], pos: [], grns: [], invoices: [], people: [], agents: [], bankDirectory: [], bankScripts: {}, grnArrivals: [], vendorOnboarding: [], storyAccounts: { fraud: { accountNo: "", ifsc: "", holder: "" }, shivamNew: { accountNo: "", ifsc: "", holder: "" } } };
}

export const OrgInput = z.strictObject({
  legalName: z.string().trim().min(3).max(120),
  brand: z.string().trim().min(2).max(60),
  gstin: z.string().refine(isGstin, "Not a valid GSTIN"),
  city: z.string().trim().min(2).max(60),
  founder: z.strictObject({ name: z.string().trim().min(2).max(80), title: z.string().trim().min(2).max(80), email: z.email() }),
});
export type OrgInput = z.infer<typeof OrgInput>;

/** Start a live company. The founder is its first governor and is registered with their first passkey. */
export function createOrg(companyId: string, input: OrgInput, founderId: string, credential: PasskeyCredential, rp: RelyingParty, at: ISO): Treasury {
  const company: Company = { id: companyId, legalName: input.legalName, brand: input.brand, gstin: input.gstin, pan: input.gstin.slice(2, 12), city: input.city, accountNo: "", ifsc: "", openingBalance: 0, tile: { bg: "#EBF0F8", fg: "#002E6E" } };
  const t = new Treasury(emptyWorld(company), companyId, { mode: "live", start: at });
  const founder: Person = { id: founderId, companyId, name: input.founder.name, title: input.founder.title, email: input.founder.email, roles: ["governor"], publicKey: "", credentials: [credential] };
  t.emit({ at, type: "org_created", actor: "person", ruleId: "GOVERNANCE_V1", payload: { company, rp, founder } });
  return t;
}

/** Rebuild from the ledger. The first event carries the company. */
export function loadOrg(events: import("./types").LedgerEvent[]): Treasury {
  const g = events[0];
  if (!g || g.type !== "org_created") throw new Error("ledger does not start with org_created");
  const company = g.payload.company as Company;
  return Treasury.fromLedger(emptyWorld(company), company.id, events);
}

/** Someone opens their invite link and registers a passkey. The token itself never reaches the ledger. */
export function acceptInvite(t: Treasury, at: ISO, inviteId: string, tokenHash: string, personId: string, credential: PasskeyCredential): LiveResult {
  t.advance(at);
  const inv = t.state.invites.get(inviteId);
  if (!inv || inv.status !== "open") return { ok: false, reason: "INVITE_NOT_OPEN" };
  if (inv.expiresAt < at) return { ok: false, reason: "INVITE_EXPIRED" };
  if (inv.tokenHash !== tokenHash) return refuse(t, at, "accept_invite", inviteId, "BAD_INVITE_TOKEN");
  if (t.world.people.some((p) => p.id === personId)) return { ok: false, reason: "DUPLICATE_PERSON" };
  const person: Person = { id: personId, companyId: t.companyId, name: inv.name, title: inv.title, email: inv.email, roles: inv.roles, publicKey: "", credentials: [credential] };
  t.emit({ at, type: "person_registered", actor: "person", ruleId: "GOVERNANCE_V1", payload: { person, inviteId } });
  return ok({ personId });
}

/** Add another passkey (a second device). Signed with an existing one. */
export function addPasskey(t: Treasury, at: ISO, personId: string, credential: PasskeyCredential): LiveResult {
  const p = t.world.people.find((x) => x.id === personId && x.companyId === t.companyId);
  if (!p) return { ok: false, reason: "NOT_IN_COMPANY" };
  if (p.credentials?.some((c) => c.id === credential.id)) return { ok: false, reason: "DUPLICATE_PASSKEY" };
  t.emit({ at, type: "passkey_added", actor: "person", payload: { personId, credential } });
  return ok();
}

// ---------------- agents ----------------

const id40 = z.string().regex(/^[A-Za-z0-9._/-]{1,40}$/);
const line = z.strictObject({ sku: id40, qty: z.number().int().positive().max(1_000_000), rate: z.number().int().positive().safe() });
export const AgentCommand = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("submit_po"), po: z.strictObject({ id: id40, vendorId: z.string(), lines: z.array(line).min(1).max(100) }) }),
  z.strictObject({ kind: z.literal("submit_grn"), grn: z.strictObject({ id: id40, poId: id40, lines: z.array(z.strictObject({ sku: id40, qty: z.number().int().nonnegative() })).min(1).max(100) }) }),
  z.strictObject({ kind: z.literal("submit_invoice"), invoice: z.strictObject({
    number: z.string().trim().min(1).max(40), vendorId: z.string(), poId: id40, date: z.iso.datetime(), gstin: z.string().max(15),
    lines: z.array(line).min(1).max(100), gst: z.number().int().nonnegative().safe(),
    email: z.strictObject({ from: z.string().max(200), subject: z.string().max(300), body: z.string().max(20_000) }).optional(),
  }) }),
  z.strictObject({ kind: z.literal("propose"), invoiceId: z.string() }),
  z.strictObject({ kind: z.literal("attest"), intentHash: z.string().regex(/^[0-9a-f]{64}$/), verdict: z.enum(["approve", "escalate", "reject"]), reasons: z.array(z.string().max(120)).min(1).max(12), signedAt: z.iso.datetime(), sig: z.string().regex(/^[0-9a-f]{128}$/) }),
]);
export type AgentCommand = z.infer<typeof AgentCommand>;

const CAN: Record<AgentCommand["kind"], ClientRole[]> = {
  submit_po: ["erp", "proposer"], submit_grn: ["erp", "proposer"], submit_invoice: ["erp", "proposer"], propose: ["proposer"], attest: ["proposer", "compliance", "risk"],
};
const SKEW_MS = 5 * 60_000;
const fresh = (signedAt: ISO, at: ISO) => Math.abs(new Date(at).getTime() - new Date(signedAt).getTime()) <= SKEW_MS;

function refuse(t: Treasury, at: ISO, kind: string, by: string, reason: string): LiveResult {
  t.emit({ at, type: "command_refused", actor: by.startsWith("a_") ? "agent" : "person", payload: { kind, by, reason } });
  return { ok: false, reason };
}

export function agentCommand(t: Treasury, at: ISO, agentId: string, raw: unknown): LiveResult {
  t.advance(at);
  const parsed = AgentCommand.safeParse(raw);
  const kind = (raw as { kind?: string })?.kind ?? "unknown";
  if (!parsed.success) return { ok: false, reason: `INVALID: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ").slice(0, 300)}` };
  const c = parsed.data;
  const st = t.state, w = t.world;
  const agent = w.agents.find((a) => a.id === agentId && a.companyId === t.companyId);
  if (!agent || st.agentStatus.get(agentId) !== "active") return refuse(t, at, kind, agentId, "AGENT_NOT_ACTIVE");
  if (!CAN[c.kind].includes(agent.role)) return refuse(t, at, kind, agentId, "ROLE_NOT_ALLOWED");
  const vendorOf = (id: string) => w.vendors.find((v) => v.id === id && v.companyId === t.companyId);

  switch (c.kind) {
    case "submit_po": {
      if (!vendorOf(c.po.vendorId)) return refuse(t, at, kind, agentId, "UNKNOWN_VENDOR");
      if (w.pos.some((p) => p.id === c.po.id)) return refuse(t, at, kind, agentId, "DUPLICATE_PO");
      t.emit({ at, type: "po_created", actor: "agent", payload: { po: { ...c.po, companyId: t.companyId, createdAt: at }, by: agentId } });
      return ok({ poId: c.po.id });
    }
    case "submit_grn": {
      const po = w.pos.find((p) => p.id === c.grn.poId);
      if (!po) return refuse(t, at, kind, agentId, "UNKNOWN_PO");
      if (w.grns.some((g) => g.id === c.grn.id)) return refuse(t, at, kind, agentId, "DUPLICATE_GRN");
      t.emit({ at, type: "grn_created", actor: "agent", payload: { grn: { ...c.grn, companyId: t.companyId, receivedAt: at }, by: agentId } });
      for (const inv of w.invoices.filter((x) => x.poId === po.id)) {
        const s = st.invoices.get(inv.id)!;
        if (s.status === "held" && s.reasons.some((r) => r.includes("goods receipt"))) {
          t.emit({ at, type: "invoice_released", actor: "system", ruleId: "HOLD_MATCH_V1", payload: { invoiceId: inv.id, why: "Goods receipt arrived" } });
          t.process(inv.id, at);
        }
      }
      return ok({ grnId: c.grn.id });
    }
    case "submit_invoice": {
      const v = vendorOf(c.invoice.vendorId);
      if (!v) return refuse(t, at, kind, agentId, "UNKNOWN_VENDOR");
      const taxable = c.invoice.lines.reduce((s, l) => s + l.qty * l.rate, 0);
      if (!Number.isSafeInteger(taxable + c.invoice.gst)) return refuse(t, at, kind, agentId, "AMOUNT_TOO_LARGE");
      const expectedGst = Math.round((taxable * GST_BPS[v.category]) / 10_000);
      if (Math.abs(expectedGst - c.invoice.gst) > 100) return refuse(t, at, kind, agentId, "GST_DOES_NOT_ADD_UP");
      const id = `inv_${w.invoices.length + 1}`;
      const invoice: Invoice = {
        id, companyId: t.companyId, vendorId: v.id, number: c.invoice.number, date: c.invoice.date, poId: c.invoice.poId, lines: c.invoice.lines,
        taxable, gst: c.invoice.gst, total: taxable + c.invoice.gst, gstin: c.invoice.gstin, arrivesAt: at,
        email: c.invoice.email ?? { from: v.email, subject: `Invoice ${c.invoice.number}`, body: "" },
      };
      t.emit({ at, type: "invoice_submitted", actor: "agent", payload: { invoice, by: agentId } });
      t.arrive(id, at);
      return ok({ invoiceId: id, status: st.invoices.get(id)!.status, flags: st.invoices.get(id)!.flags });
    }
    case "propose": {
      const s = st.invoices.get(c.invoiceId);
      if (!s || w.invoices.find((i) => i.id === c.invoiceId)?.companyId !== t.companyId) return refuse(t, at, kind, agentId, "UNKNOWN_INVOICE");
      if (s.status !== "received") return refuse(t, at, kind, agentId, `INVOICE_${s.status.toUpperCase()}`);
      const b = buildIntent(t, c.invoiceId, at);
      if ("hold" in b) {
        t.emit({ at, type: "invoice_held", actor: "agent", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { invoiceId: c.invoiceId, reasons: [b.hold] } });
        return { ok: false, reason: "HELD", data: { why: b.hold } };
      }
      if (b.intent.modelHash !== agent.modelHash) return refuse(t, at, kind, agentId, "NOT_THE_ACTIVE_PROPOSER");
      const hash = intentHash(b.intent);
      const last = st.intentByInvoice.get(c.invoiceId);
      t.emit({ at, type: "intent_proposed", actor: "agent", ruleId: "RECEIPT_V1", payload: { intentHash: hash, intent: b.intent, attempt: last ? st.intents.get(last)!.attempt + 1 : 1, by: agentId } });
      return ok({ intentHash: hash, intent: b.intent });
    }
    case "attest": {
      const it = st.intents.get(c.intentHash);
      if (!it || it.intent.companyId !== t.companyId) return refuse(t, at, kind, agentId, "UNKNOWN_INTENT");
      if (!["attesting", "awaiting_approval"].includes(it.status)) return refuse(t, at, kind, agentId, `INTENT_${it.status.toUpperCase()}`);
      if (it.attestations.some((a) => a.role === agent.role)) return refuse(t, at, kind, agentId, "ALREADY_ATTESTED");
      if (!fresh(c.signedAt, at) || c.signedAt < it.intent.createdAt) return refuse(t, at, kind, agentId, "STALE_SIGNATURE");
      const a = { signerId: agentId, role: agent.role as AgentRole, verdict: c.verdict, reasons: c.reasons, intentHash: c.intentHash, signedAt: c.signedAt, sig: c.sig };
      if (!verifySig(agent.publicKey, attestMessage(a), a.sig)) return refuse(t, at, kind, agentId, "BAD_SIGNATURE");
      t.emit({ at, type: c.verdict === "reject" ? "agent_refused" : "attested", actor: "agent", ruleId: "RECEIPT_V1", payload: { intentHash: c.intentHash, attestation: a } });
      if (c.verdict === "reject") {
        const dup = c.reasons.some((r) => /DUPLICATE/i.test(r));
        const rule: B2BRuleId = dup ? "HOLD_DUPLICATE_V1" : c.reasons.some((r) => /GSTIN/i.test(r)) ? "HOLD_GSTIN_V1" : c.reasons.some((r) => /MATCH|GRN|RECEIV/i.test(r)) ? "HOLD_MATCH_V1" : "RECEIPT_V1";
        for (const id of it.intent.invoiceIds) {
          t.emit({ at, type: dup ? "invoice_rejected" : "invoice_held", actor: "agent", ruleId: rule, payload: { invoiceId: id, reasons: c.reasons.map((r) => `${agent.name}: ${r}`) } });
          if (dup) t.emit({ at, type: "stopped", actor: "agent", ruleId: rule, payload: { invoiceId: id, amount: it.intent.amount, reason: "Duplicate invoice" } });
        }
        return ok({ status: "refused" });
      }
      const roles = new Set(st.intents.get(c.intentHash)!.attestations.map((x) => x.role));
      if (roles.has("proposer") && roles.has("compliance") && roles.has("risk")) t.release(c.intentHash, at);
      return ok({ status: st.intents.get(c.intentHash)!.status });
    }
  }
}

// ---------------- people ----------------

const auth = z.strictObject({
  at: z.iso.datetime(),
  webauthn: z.strictObject({ credentialId: z.string().max(400), authenticatorData: z.string().max(4000), clientDataJSON: z.string().max(4000), signature: z.string().max(1000) }),
});
const roles = z.array(z.enum(["maker", "checker", "cfo", "governor"])).min(1).max(4);
const money = z.number().int().positive().safe();

export const PersonCommand = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("invite_person"), name: z.string().trim().min(2).max(80), title: z.string().trim().min(2).max(80), email: z.email(), roles, inviteId: z.string().regex(/^inv_[a-z0-9]{8,40}$/), tokenHash: z.string().regex(/^[0-9a-f]{64}$/), auth }),
  z.strictObject({ kind: z.literal("revoke_invite"), inviteId: z.string(), auth }),
  z.strictObject({ kind: z.literal("register_agent"), agentId: z.string().regex(/^a_[a-z0-9_]{4,40}$/), name: z.string().trim().min(2).max(60), role: z.enum(["proposer", "compliance", "risk", "erp"]), modelLabel: z.string().trim().min(2).max(80), publicKey: z.string().regex(/^[0-9a-f]{64}$/), apiKeyHash: z.string().regex(/^[0-9a-f]{64}$/), apiKeyPrefix: z.string().max(24), auth }),
  z.strictObject({ kind: z.literal("rotate_api_key"), agentId: z.string(), apiKeyHash: z.string().regex(/^[0-9a-f]{64}$/), apiKeyPrefix: z.string().max(24), auth }),
  z.strictObject({ kind: z.literal("seal_org"), auth }),
  z.strictObject({ kind: z.literal("fund_sandbox"), amount: money.max(100_00_00_000_00), auth }),
  z.strictObject({ kind: z.literal("sandbox_account"), accountNo: z.string().regex(/^\d{9,18}$/), ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), holder: z.string().trim().min(2).max(80), auth }),
  z.strictObject({ kind: z.literal("add_vendor"), vendor: z.strictObject({
    legalName: z.string().trim().min(2).max(120), brand: z.string().trim().min(2).max(60), gstin: z.string().refine(isGstin, "Not a valid GSTIN"), pan: z.string().refine(isPan, "Not a valid PAN"),
    category: z.enum(["goods", "logistics", "services", "rent"]), msme: z.boolean(), udyam: z.string().max(40).optional(), phoneOnFile: z.string().trim().min(6).max(20), email: z.email(), termsDays: z.number().int().min(0).max(180),
  }), auth }),
  z.strictObject({ kind: z.literal("change_request"), vendorId: z.string(), accountNo: z.string().regex(/^\d{9,18}$/), ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), auth }),
  z.strictObject({ kind: z.literal("callback"), requestId: z.string(), outcome: z.enum(["confirmed", "denied"]), auth }),
  z.strictObject({ kind: z.literal("decide_change"), requestId: z.string(), decision: z.enum(["approved", "rejected"]), auth }),
  z.strictObject({ kind: z.literal("approve"), intentHash: z.string(), role: z.enum(["checker", "cfo"]), auth }),
  z.strictObject({ kind: z.literal("decline"), intentHash: z.string(), reason: z.string().trim().min(3).max(200), auth }),
  z.strictObject({ kind: z.literal("propose_policy"), changes: PolicyChanges, auth }),
  z.strictObject({ kind: z.literal("propose_unfreeze"), auth }),
  z.strictObject({ kind: z.literal("propose_reinstate"), agentId: z.string(), auth }),
  z.strictObject({ kind: z.literal("sign_proposal"), proposalId: z.string(), auth }),
  z.strictObject({ kind: z.literal("veto_proposal"), proposalId: z.string(), auth }),
  z.strictObject({ kind: z.literal("freeze"), reason: z.string().trim().min(3).max(200), auth }),
  z.strictObject({ kind: z.literal("suspend_agent"), agentId: z.string(), reason: z.string().trim().min(3).max(200), auth }),
]);
export type PersonCommand = z.infer<typeof PersonCommand>;

/** The exact message a person's passkey signs for a command. Approvals and governance signatures use their own
 *  domain so they stay valid on their own inside the receipt and the proposal. */
export function messageFor(t: Treasury, personId: string, c: { kind: string; [k: string]: unknown }, at: ISO): string {
  const { auth: _auth, ...params } = c;
  void _auth;
  if (c.kind === "approve") return approveMessage({ companyId: t.companyId, intentHash: String(c.intentHash), personId, role: String(c.role), at });
  if (c.kind === "sign_proposal") {
    const pr = t.state.proposals.get(String(c.proposalId));
    return governMessage({ companyId: t.companyId, proposalHash: pr?.hash ?? "missing", personId });
  }
  return actionMessage({ companyId: t.companyId, personId, kind: c.kind, params, at });
}

const governHash = (companyId: string, id: string, kind: string, policy: Policy, extra: unknown) => dhash("govern", canonical({ id, kind, companyId, policyHash: policyHash(policy), extra: extra ?? null }));

export function personCommand(t: Treasury, at: ISO, personId: string, raw: unknown): LiveResult {
  t.advance(at);
  const parsed = PersonCommand.safeParse(raw);
  const kind = (raw as { kind?: string })?.kind ?? "unknown";
  if (!parsed.success) return { ok: false, reason: `INVALID: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ").slice(0, 300)}` };
  const c = parsed.data;
  const st = t.state, w = t.world;
  const me = w.people.find((p) => p.id === personId && p.companyId === t.companyId);
  if (!me) return { ok: false, reason: "NOT_IN_COMPANY" };
  // The signature: fresh, for exactly this command, from one of this person's passkeys.
  const skewOk = c.auth.at <= addMin(at, 1) && new Date(at).getTime() - new Date(c.auth.at).getTime() <= SKEW_MS;
  if (!skewOk) return refuse(t, at, kind, personId, "STALE_SIGNATURE");
  const message = messageFor(t, personId, c, c.auth.at);
  if (!verifyPersonSig(me, message, { webauthn: c.auth.webauthn as WebAuthnSig }, st.rp, true)) return refuse(t, at, kind, personId, "BAD_PASSKEY_SIGNATURE");
  const has = (r: PersonRole) => me.roles.includes(r);
  const governors = () => w.people.filter((p) => p.companyId === t.companyId && p.roles.includes("governor"));
  const { auth: _a, ...params } = c;
  void _a;
  const sigRecord = (k: "action" | "govern") => canonical({ kind: k, at: c.auth.at, webauthn: c.auth.webauthn });

  switch (c.kind) {
    case "invite_person": {
      if (!has("governor")) return refuse(t, at, kind, personId, "NOT_A_GOVERNOR");
      if (!st.sealed && personId !== st.founder) return refuse(t, at, kind, personId, "ONLY_FOUNDER_BEFORE_SEAL");
      if (st.sealed && c.roles.includes("governor")) return refuse(t, at, kind, personId, "GOVERNORS_ARE_FIXED_AFTER_SEAL");
      if (st.invites.has(c.inviteId)) return refuse(t, at, kind, personId, "DUPLICATE_INVITE");
      t.emit({ at, type: "person_invited", actor: "person", ruleId: "GOVERNANCE_V1", payload: { invite: { id: c.inviteId, name: c.name, title: c.title, email: c.email, roles: c.roles, tokenHash: c.tokenHash, expiresAt: addMin(at, 7 * 24 * 60), by: personId }, sig: sigRecord("action") } });
      return ok({ inviteId: c.inviteId });
    }
    case "revoke_invite": {
      const inv = st.invites.get(c.inviteId);
      if (!has("governor") || !inv || inv.status !== "open") return refuse(t, at, kind, personId, "NOT_OPEN");
      t.emit({ at, type: "invite_revoked", actor: "person", payload: { inviteId: c.inviteId, by: personId } });
      return ok();
    }
    case "register_agent": {
      if (!has("governor")) return refuse(t, at, kind, personId, "NOT_A_GOVERNOR");
      if (w.agents.some((a) => a.id === c.agentId || a.publicKey === c.publicKey)) return refuse(t, at, kind, personId, "DUPLICATE_AGENT");
      const agent: Agent = { id: c.agentId, companyId: t.companyId, role: c.role, name: c.name, publicKey: c.publicKey, modelHash: dhash("model", c.modelLabel), modelLabel: c.modelLabel, apiKeyHash: c.apiKeyHash, apiKeyPrefix: c.apiKeyPrefix };
      if (c.role !== "erp" && w.agents.some((a) => a.role === c.role && st.agentStatus.get(a.id) === "active")) return refuse(t, at, kind, personId, "ROLE_ALREADY_FILLED");
      if (!st.sealed) {
        if (personId !== st.founder) return refuse(t, at, kind, personId, "ONLY_FOUNDER_BEFORE_SEAL");
        t.emit({ at, type: "agent_registered", actor: "person", ruleId: "KEY_SUSPEND_V1", payload: { agent, by: personId, sig: sigRecord("action") } });
        return ok({ agentId: agent.id });
      }
      // After sealing a new signing key is a governance decision.
      return propose(t, at, me, "register_agent", st.policy, { agent }, sigRecord("action"), params);
    }
    case "rotate_api_key": {
      if (!has("governor")) return refuse(t, at, kind, personId, "NOT_A_GOVERNOR");
      if (!w.agents.some((a) => a.id === c.agentId && a.companyId === t.companyId)) return refuse(t, at, kind, personId, "UNKNOWN_AGENT");
      t.emit({ at, type: "api_key_rotated", actor: "person", payload: { agentId: c.agentId, apiKeyHash: c.apiKeyHash, apiKeyPrefix: c.apiKeyPrefix, by: personId } });
      return ok();
    }
    case "seal_org": {
      if (personId !== st.founder) return refuse(t, at, kind, personId, "ONLY_FOUNDER");
      if (st.sealed) return refuse(t, at, kind, personId, "ALREADY_SEALED");
      const ppl = w.people.filter((p) => p.companyId === t.companyId);
      const missing: string[] = [];
      if (ppl.filter((p) => p.roles.includes("governor")).length !== 3) missing.push("exactly three governors");
      for (const r of ["maker", "checker", "cfo"] as const) if (!ppl.some((p) => p.roles.includes(r))) missing.push(`a ${r}`);
      for (const r of ["proposer", "compliance", "risk"] as const) if (!w.agents.some((a) => a.role === r && st.agentStatus.get(a.id) === "active")) missing.push(`a ${r} agent`);
      const roleClash = ppl.find((p) => p.roles.includes("maker") && (p.roles.includes("checker") || p.roles.includes("cfo")));
      if (roleClash) missing.push(`${roleClash.name} cannot be both maker and approver`);
      if (missing.length) return { ok: false, reason: "NOT_READY", data: { missing } };
      t.emit({ at, type: "org_sealed", actor: "person", ruleId: "GOVERNANCE_V1", payload: { by: personId, governors: governors().map((g) => g.id), sig: sigRecord("action") } });
      return ok();
    }
    case "fund_sandbox": {
      if (!has("governor") && !has("cfo")) return refuse(t, at, kind, personId, "WRONG_ROLE");
      t.emit({ at, type: "sandbox_funded", actor: "person", payload: { amount: c.amount, by: personId, note: "Simulated money" } });
      return ok({ balance: st.balance });
    }
    case "sandbox_account": {
      if (w.bankDirectory.some((b) => b.accountNo === c.accountNo && b.ifsc === c.ifsc)) return refuse(t, at, kind, personId, "ACCOUNT_EXISTS");
      t.emit({ at, type: "sandbox_account_created", actor: "person", payload: { accountNo: c.accountNo, ifsc: c.ifsc, holder: c.holder.toUpperCase(), by: personId, note: "Sandbox bank only" } });
      return ok();
    }
    case "add_vendor": {
      if (!has("maker")) return refuse(t, at, kind, personId, "NOT_A_MAKER");
      if (w.vendors.some((v) => v.gstin === c.vendor.gstin)) return refuse(t, at, kind, personId, "VENDOR_EXISTS");
      if (c.vendor.gstin.slice(2, 12) !== c.vendor.pan) return refuse(t, at, kind, personId, "PAN_NOT_IN_GSTIN");
      const id = `v_${w.vendors.length + 1}`;
      t.emit({ at, type: "vendor_registered", actor: "person", payload: { vendor: { ...c.vendor, id, companyId: t.companyId, history: [] }, by: personId, sig: sigRecord("action") } });
      return ok({ vendorId: id });
    }
    case "change_request": {
      if (!has("maker")) return refuse(t, at, kind, personId, "NOT_A_MAKER");
      if (!w.vendors.some((v) => v.id === c.vendorId && v.companyId === t.companyId)) return refuse(t, at, kind, personId, "UNKNOWN_VENDOR");
      if ((st.newBeneficiariesByDay.get(t.dayKey(at)) ?? 0) >= st.policy.maxNewBeneficiariesPerDay) return refuse(t, at, kind, personId, "TOO_MANY_NEW_ACCOUNTS_TODAY");
      if ([...st.changeRequests.values()].some((r) => r.vendorId === c.vendorId && r.status === "open")) return refuse(t, at, kind, personId, "REQUEST_ALREADY_OPEN");
      const id = `cr_${c.vendorId.slice(2)}_${st.changeRequests.size + 1}`;
      t.openChangeRequest(at, { id, vendorId: c.vendorId, source: "vendor_portal", accountNo: c.accountNo, ifsc: c.ifsc, holderClaimed: null, openedBy: personId });
      return ok({ requestId: id });
    }
    case "callback": {
      const cr = st.changeRequests.get(c.requestId);
      if (!has("maker")) return refuse(t, at, kind, personId, "NOT_A_MAKER");
      if (!cr || cr.status !== "open" || cr.callback) return refuse(t, at, kind, personId, "NOT_OPEN");
      const v = w.vendors.find((x) => x.id === cr.vendorId)!;
      t.emit({ at, type: "callback_logged", actor: "person", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { requestId: cr.id, by: personId, byName: me.name, outcome: c.outcome, number: `Number on file, ${v.phoneOnFile.slice(-4).padStart(v.phoneOnFile.length, "x")}`, note: "Called the number in the vendor master, not any number in the request", sig: sigRecord("action") } });
      if (c.outcome === "denied") {
        t.emit({ at, type: "change_request_decided", actor: "system", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { requestId: cr.id, decision: "rejected", by: "rule", reason: "Vendor says they did not ask for this change" } });
        const inv = cr.invoiceId ? w.invoices.find((i) => i.id === cr.invoiceId) : undefined;
        t.openCase(at, "fraud_attempt", v.id, cr.invoiceId, inv?.total ?? 0, `Someone asked to send ${v.brand}'s payments to an account held by ${cr.penny?.holder ?? "an unknown person"}. ${v.brand} confirmed on the number on file that they made no such request.`, cr.id);
        t.emit({ at, type: "stopped", actor: "system", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { requestId: cr.id, invoiceId: cr.invoiceId, amount: inv?.total ?? 0, reason: "Bank change fraud stopped" } });
      }
      for (const it of [...st.intents.values()]) if (it.intent.vendorId === v.id && (it.status === "awaiting_approval" || it.status === "blocked")) t.release(it.hash, at);
      return ok();
    }
    case "decide_change": {
      const cr = st.changeRequests.get(c.requestId);
      if (!has("checker")) return refuse(t, at, kind, personId, "NOT_A_CHECKER");
      if (!cr || cr.status !== "open") return refuse(t, at, kind, personId, "NOT_OPEN");
      if (cr.openedBy === personId || cr.callback?.by === personId) return refuse(t, at, kind, personId, "SOD_SAME_PERSON");
      if (c.decision === "approved") {
        if (cr.callback?.outcome !== "confirmed") return refuse(t, at, kind, personId, "CALLBACK_REQUIRED");
        if (!cr.penny?.found || cr.penny.score < 80) return refuse(t, at, kind, personId, "NAME_MISMATCH");
      }
      t.emit({ at, type: "change_request_decided", actor: "person", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { requestId: cr.id, decision: c.decision, by: personId, reason: c.decision === "approved" ? "Penny drop name matches and the vendor confirmed on the number on file" : "Rejected by checker", sig: sigRecord("action") } });
      if (c.decision === "approved") {
        const old = st.activeBeneficiary(cr.vendorId, at);
        const n = [...st.beneficiaries.values()].filter((b) => b.vendorId === cr.vendorId).length + 1;
        const beneficiary = { id: `b_${cr.vendorId.slice(2)}_${n}`, companyId: t.companyId, vendorId: cr.vendorId, accountNo: cr.accountNo, ifsc: cr.ifsc, nameAtBank: cr.penny!.holder!, accountHash: cr.accountHash, addedAt: at, addedVia: old ? ("change_request" as const) : ("onboarding" as const), approvedBy: personId };
        const cooling = old ? st.policy.coolingHoursChanged : st.policy.coolingHoursNew;
        t.emit({ at, type: "beneficiary_added", actor: "person", ruleId: "COOLING_V1", payload: { beneficiary, replaces: old?.id ?? null, usableFrom: addMin(at, cooling * 60) } });
        if (old) t.emit({ at, type: "beneficiary_retired", actor: "system", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { beneficiaryId: old.id, why: "Replaced by a verified new account" } });
        for (const inv of w.invoices) {
          const s = st.invoices.get(inv.id)!;
          if (inv.vendorId === cr.vendorId && s.status === "held" && s.reasons.some((r) => r.includes("No approved bank account"))) t.emit({ at, type: "invoice_released", actor: "system", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { invoiceId: inv.id, why: "Bank account approved" } });
        }
      }
      t.retryWaiting(at);
      return ok();
    }
    case "approve": {
      const it = st.intents.get(c.intentHash);
      if (!has(c.role)) return refuse(t, at, kind, personId, "WRONG_ROLE");
      if (!it || it.status !== "awaiting_approval" || !it.needs.includes(c.role)) return refuse(t, at, kind, personId, "NOT_AWAITING_APPROVAL");
      if (it.approvals.some((a) => a.personId === personId || a.role === c.role)) return refuse(t, at, kind, personId, "ALREADY_SIGNED");
      if (it.intent.preparedFor === personId) return refuse(t, at, kind, personId, "SOD_PREPARED_IT");
      const approval = { personId, role: c.role, intentHash: c.intentHash, companyId: t.companyId, at: c.auth.at, sig: "", webauthn: c.auth.webauthn as WebAuthnSig };
      t.emit({ at, type: "approved", actor: "person", ruleId: c.role === "cfo" ? "PAYOUT_CFO_V1" : "PAYOUT_CHECKER_V1", payload: { intentHash: c.intentHash, approval, name: me.name } });
      t.release(c.intentHash, at);
      return ok({ status: st.intents.get(c.intentHash)!.status });
    }
    case "decline": {
      const it = st.intents.get(c.intentHash);
      if (!has("checker") && !has("cfo")) return refuse(t, at, kind, personId, "WRONG_ROLE");
      if (!it || it.status !== "awaiting_approval") return refuse(t, at, kind, personId, "NOT_AWAITING_APPROVAL");
      t.emit({ at, type: "approval_declined", actor: "person", ruleId: "PAYOUT_CHECKER_V1", payload: { intentHash: c.intentHash, by: personId, byName: me.name, reason: c.reason, sig: sigRecord("action") } });
      return ok();
    }
    case "propose_policy": case "propose_unfreeze": case "propose_reinstate": {
      if (!has("governor")) return refuse(t, at, kind, personId, "NOT_A_GOVERNOR");
      if (!st.sealed) return refuse(t, at, kind, personId, "SEAL_FIRST");
      if (c.kind === "propose_unfreeze" && !st.frozen.on) return refuse(t, at, kind, personId, "NOT_FROZEN");
      if (c.kind === "propose_reinstate" && st.agentStatus.get(c.agentId) !== "suspended") return refuse(t, at, kind, personId, "NOT_SUSPENDED");
      if (c.kind === "propose_policy") {
        const policy: Policy = { ...st.policy, ...c.changes, version: st.policy.version + 1 };
        if (!diffPolicy(st.policy, policy).length) return refuse(t, at, kind, personId, "NO_CHANGE");
        return propose(t, at, me, "policy", policy, null, sigRecord("action"), params);
      }
      return propose(t, at, me, c.kind === "propose_unfreeze" ? "unfreeze" : "reinstate", st.policy, c.kind === "propose_reinstate" ? { agentId: c.agentId } : null, sigRecord("action"), params);
    }
    case "sign_proposal": {
      const pr = st.proposals.get(c.proposalId);
      if (!has("governor")) return refuse(t, at, kind, personId, "NOT_A_GOVERNOR");
      if (!pr || pr.status !== "proposed") return refuse(t, at, kind, personId, "NOT_OPEN");
      if (pr.sigs[personId]) return refuse(t, at, kind, personId, "ALREADY_SIGNED");
      t.emit({ at, type: "policy_signed", actor: "person", ruleId: "GOVERNANCE_V1", payload: { proposalId: pr.id, by: personId, sig: sigRecord("govern") } });
      return maybeCarry(t, at, pr.id);
    }
    case "veto_proposal": {
      const pr = st.proposals.get(c.proposalId);
      if (!has("governor")) return refuse(t, at, kind, personId, "NOT_A_GOVERNOR");
      if (!pr || !(pr.status === "proposed" || pr.status === "scheduled")) return refuse(t, at, kind, personId, "NOT_OPEN");
      t.emit({ at, type: "policy_vetoed", actor: "person", ruleId: "TIMELOCK_V1", payload: { proposalId: pr.id, by: personId, byName: me.name, hoursLeft: pr.effectiveAt ? Math.round(hoursBetween(at, pr.effectiveAt)) : null, sig: sigRecord("action") } });
      return ok();
    }
    case "freeze": {
      if (!(has("governor") || has("cfo") || has("checker"))) return refuse(t, at, kind, personId, "WRONG_ROLE");
      if (st.frozen.on) return refuse(t, at, kind, personId, "ALREADY_FROZEN");
      t.emit({ at, type: "freeze", actor: "person", ruleId: "FREEZE_V1", payload: { on: true, by: me.name, reason: c.reason, sig: sigRecord("action") } });
      return ok();
    }
    case "suspend_agent": {
      const a = w.agents.find((x) => x.id === c.agentId && x.companyId === t.companyId);
      if (!has("governor")) return refuse(t, at, kind, personId, "NOT_A_GOVERNOR");
      if (!a || st.agentStatus.get(a.id) !== "active") return refuse(t, at, kind, personId, "NOT_ACTIVE");
      t.emit({ at, type: "agent_suspended", actor: "person", ruleId: "KEY_SUSPEND_V1", payload: { agentId: a.id, by: me.name, reason: c.reason, sig: sigRecord("action") } });
      return ok();
    }
  }
}

function propose(t: Treasury, at: ISO, me: Person, kind: "policy" | "unfreeze" | "reinstate" | "register_agent", policy: Policy, extra: { agentId?: string; agent?: Agent } | null, sig: string, params: unknown): LiveResult {
  const st = t.state;
  const id = `GOV-${100 + st.proposals.size + 1}`;
  const diff = kind === "policy" ? diffPolicy(st.policy, policy) : [];
  const hash = governHash(t.companyId, id, kind, policy, extra);
  t.emit({ at, type: "policy_proposed", actor: "person", ruleId: "GOVERNANCE_V1", payload: { proposal: { id, kind, ...(extra ?? {}), policy, hash, diff, loosening: kind === "policy" ? isLoosening(diff) : true, by: me.id, at, sigs: { [me.id]: sig }, signedParams: params, status: "proposed" } } });
  return ok({ proposalId: id, proposalHash: hash });
}

/** Count signatures that verify, from distinct governors; carry the proposal at two. */
function maybeCarry(t: Treasury, at: ISO, proposalId: string): LiveResult {
  const st = t.state, w = t.world;
  const pr = st.proposals.get(proposalId)!;
  let valid = 0;
  for (const [pid, raw] of Object.entries(pr.sigs)) {
    const g = w.people.find((p) => p.id === pid && p.companyId === t.companyId && p.roles.includes("governor"));
    if (!g) continue;
    try {
      const s = JSON.parse(raw) as { kind: "action" | "govern"; at: string; webauthn: WebAuthnSig };
      const message = s.kind === "govern"
        ? governMessage({ companyId: t.companyId, proposalHash: pr.hash, personId: pid })
        : actionMessage({ companyId: t.companyId, personId: pid, kind: pr.kind === "policy" ? "propose_policy" : pr.kind === "unfreeze" ? "propose_unfreeze" : pr.kind === "reinstate" ? "propose_reinstate" : "register_agent", params: pr.signedParams ?? proposalParams(pr), at: s.at });
      if (verifyPersonSig(g, message, { webauthn: s.webauthn }, st.rp, true)) valid++;
    } catch { /* an unreadable signature does not count */ }
  }
  if (valid < GOVERNANCE_THRESHOLD) return ok({ signatures: valid });
  if (pr.kind === "policy" && pr.loosening) {
    t.emit({ at, type: "policy_scheduled", actor: "system", ruleId: "TIMELOCK_V1", payload: { proposalId: pr.id, effectiveAt: addMin(at, TIMELOCK_HOURS * 60) } });
  } else if (pr.kind === "policy") {
    t.emit({ at, type: "policy_activated", actor: "system", ruleId: "GOVERNANCE_V1", payload: { proposalId: pr.id, version: pr.policy.version, hash: pr.hash } });
    t.replanAll(at, `Policy v${pr.policy.version} is now active`);
  } else if (pr.kind === "unfreeze") {
    t.emit({ at, type: "proposal_executed", actor: "system", ruleId: "GOVERNANCE_V1", payload: { proposalId: pr.id } });
    t.emit({ at, type: "freeze", actor: "system", ruleId: "FREEZE_V1", payload: { on: false, by: "two governors", reason: "Released by two of three governors" } });
    t.retryWaiting(at);
  } else if (pr.kind === "reinstate") {
    t.emit({ at, type: "proposal_executed", actor: "system", ruleId: "GOVERNANCE_V1", payload: { proposalId: pr.id } });
    t.emit({ at, type: "agent_reinstated", actor: "system", ruleId: "KEY_SUSPEND_V1", payload: { agentId: pr.agentId } });
  } else {
    t.emit({ at, type: "proposal_executed", actor: "system", ruleId: "GOVERNANCE_V1", payload: { proposalId: pr.id } });
    t.emit({ at, type: "agent_registered", actor: "system", ruleId: "GOVERNANCE_V1", payload: { agent: pr.agent, by: "two governors" } });
    t.replanAll(at, `Policy v${t.state.policy.version} is now active`);
  }
  return ok({ signatures: valid, status: st.proposals.get(pr.id)!.status });
}

/** The parameters the proposer signed, rebuilt from the stored proposal. */
function proposalParams(pr: import("./state").Proposal): unknown {
  if (pr.kind === "policy") {
    const changes: Record<string, unknown> = {};
    for (const d of pr.diff) changes[d.field] = d.to;
    return { kind: "propose_policy", changes };
  }
  if (pr.kind === "unfreeze") return { kind: "propose_unfreeze" };
  if (pr.kind === "reinstate") return { kind: "propose_reinstate", agentId: pr.agentId };
  const a = pr.agent!;
  return { kind: "register_agent", agentId: a.id, name: a.name, role: a.role, modelLabel: a.modelLabel, publicKey: a.publicKey, apiKeyHash: a.apiKeyHash, apiKeyPrefix: a.apiKeyPrefix };
}

/** Which agents of which role still need to sign each open intent; what the API's work queue returns. */
export function proposeQueue(t: Treasury) {
  const st = t.state;
  return t.world.invoices.filter((i) => st.invoices.get(i.id)!.status === "received").map((i) => ({ kind: "propose" as const, invoiceId: i.id, invoice: i, flags: st.invoices.get(i.id)!.flags }));
}

export function workFor(t: Treasury, role: "compliance" | "risk") {
  const st = t.state, w = t.world;
  return [...st.intents.values()]
    .filter((it) => it.status === "attesting" && !it.attestations.some((a) => a.role === role) && (role !== "risk" || it.attestations.some((a) => a.role === "compliance")) && it.attestations.some((a) => a.role === "proposer"))
    .map((it) => {
      const inv = w.invoices.find((i) => i.id === it.intent.invoiceIds[0])!;
      return {
        kind: "attest" as const, intentHash: it.hash, intent: it.intent, invoice: inv,
        po: w.pos.find((p) => p.id === inv.poId) ?? null, grn: w.grns.find((g) => g.poId === inv.poId && st.grns.has(g.id)) ?? null,
        vendor: w.vendors.find((v) => v.id === inv.vendorId)!, beneficiary: st.beneficiaries.get(it.intent.beneficiaryId) ?? null,
        flags: st.invoices.get(inv.id)!.flags, openBankChange: [...st.changeRequests.values()].some((c) => c.vendorId === inv.vendorId && c.status === "open"),
        accepted: w.invoices.filter((i) => i.vendorId === inv.vendorId && i.id !== inv.id && ["paid", "paying", "proposed", "awaiting_approval", "deferred"].includes(st.invoices.get(i.id)!.status)).map((i) => ({ id: i.id, number: i.number, poId: i.poId, total: i.total })),
        tdsBps: st.policy.tdsBps, matchToleranceBps: st.policy.matchToleranceBps,
      };
    });
}

/** What the proposer itself must still sign: intents it proposed without its own attestation yet. */
export function unsignedProposals(t: Treasury) {
  return [...t.state.intents.values()].filter((it) => it.status === "attesting" && !it.attestations.some((a) => a.role === "proposer")).map((it) => ({ kind: "attest" as const, intentHash: it.hash, intent: it.intent }));
}

export { attestMessage };

// src/b2b/state.ts: the treasury's state, always replay(world, ledger). apply() is the only writer.
import { istDay } from "@/engine/clock";
import { addMin } from "./clock";
import { defaultPolicy, type Policy, type PolicyDiff, type Tier } from "./policy";
import { policyHash } from "./policy";
import type { BankBookEntry } from "./sim/bank";
import { ALLOWED_MODELS } from "./world";
import type { RelyingParty } from "./crypto";
import type { Agent, Approval, Attestation, Beneficiary, BusinessWorld, ISO, LedgerEvent, Paise, PaymentIntent, Person } from "./types";

export type InvoiceStatus = "not_arrived" | "received" | "held" | "rejected" | "proposed" | "awaiting_approval" | "deferred" | "paying" | "paid";
export interface InvoiceState { status: InvoiceStatus; flags: string[]; reasons: string[]; ruleId?: string; intentHash?: string; utr?: string; paidAt?: ISO; receivedAt?: ISO; msmeAlerted?: boolean }

export type IntentStatus = "attesting" | "refused" | "awaiting_approval" | "deferred" | "sent" | "pending" | "settled" | "failed" | "blocked" | "declined" | "expired";
export interface IntentState {
  intent: PaymentIntent; hash: string; attestations: Attestation[]; approvals: Approval[]; status: IntentStatus;
  tier?: Tier; needs: ("checker" | "cfo")[]; needReasons: string[]; block?: { code: string; detail: string; at: ISO };
  deferredUntil?: ISO; utr?: string; checks?: { code: string; ok: boolean; detail?: string }[]; attempt: number;
}

export interface ChangeRequest {
  id: string; vendorId: string; source: "email" | "vendor_portal"; accountNo: string; ifsc: string; accountHash: string; holderClaimed: string | null;
  openedAt: ISO; openedBy: string; invoiceId?: string; penny?: { found: boolean; holder: string | null; score: number };
  callback?: { by: string; outcome: "confirmed" | "denied"; at: ISO; number: string }; status: "open" | "approved" | "rejected"; decidedBy?: string; decidedAt?: ISO; reason?: string;
}

export interface Proposal {
  id: string; kind: "policy" | "unfreeze" | "reinstate" | "register_agent"; agentId?: string; agent?: Agent; signedParams?: unknown; policy: Policy; hash: string; diff: PolicyDiff[]; loosening: boolean; by: string; at: ISO;
  sigs: Record<string, string>; status: "proposed" | "scheduled" | "active" | "vetoed" | "superseded"; effectiveAt?: ISO; vetoedBy?: string;
}

export interface Case { id: string; kind: "fraud_attempt" | "mismatch" | "bank_failure"; vendorId: string; invoiceId?: string; requestId?: string; amount: Paise; summary: string; openedAt: ISO; status: "open" | "closed" }

export interface Invite { id: string; name: string; title: string; email: string; roles: Person["roles"]; tokenHash: string; expiresAt: ISO; by: string; status: "open" | "used" | "revoked" }

export interface Timer { at: ISO; kind: "release" | "poll" | "activate" | "expire" | "retry"; ref: string }

export type BeneficiaryState = Beneficiary & { status: "active" | "retired" | "disabled" };

export class TreasuryState {
  cursor: ISO;
  policy: Policy;
  policyHashActive: string;
  policyLog: { version: number; hash: string; at: ISO }[] = [];
  proposals = new Map<string, Proposal>();
  frozen: { on: boolean; by?: string; at?: ISO; reason?: string } = { on: false };
  agentStatus = new Map<string, "active" | "suspended">();
  beneficiaries = new Map<string, BeneficiaryState>();
  changeRequests = new Map<string, ChangeRequest>();
  invoices = new Map<string, InvoiceState>();
  intents = new Map<string, IntentState>();
  intentByInvoice = new Map<string, string>();
  nonceCounter = 0;
  consumedNonces = new Set<number>();
  consumedIntents = new Set<string>();
  spentByDay = new Map<string, Paise>();
  agentOnlyByDay = new Map<string, Paise>();
  payouts: { vendorId: string; at: ISO; amount: Paise; intentHash: string; live: boolean }[] = [];
  newBeneficiariesByDay = new Map<string, number>();
  balance: Paise;
  bankBook = new Map<string, BankBookEntry>();
  cases = new Map<string, Case>();
  pinFails = new Map<string, { count: number; lockedUntil?: ISO }>();
  grns = new Set<string>();
  timers: Timer[] = [];
  refusedCommands = 0;
  stopped: { invoiceId?: string; requestId?: string; amount: Paise; reason: string }[] = [];
  // Live mode only. A live company starts empty and is built entirely from its ledger.
  rp: RelyingParty | null = null;
  requirePasskey = false;
  /** Payouts are possible only once setup is sealed: three governors, a maker, a checker, a CFO and three agents. */
  sealed = true;
  founder?: string;
  invites = new Map<string, Invite>();

  constructor(public world: BusinessWorld, public companyId: string, start: ISO, public mode: "sim" | "live" = "sim") {
    this.cursor = start;
    this.policy = defaultPolicy(companyId, mode === "live" ? [] : ALLOWED_MODELS);
    if (mode === "live") { this.sealed = false; this.requirePasskey = true; }
    this.policyHashActive = policyHash(this.policy);
    this.policyLog.push({ version: 1, hash: this.policyHashActive, at: start });
    for (const a of world.agents) if (a.companyId === companyId) this.agentStatus.set(a.id, "active");
    for (const b of world.beneficiaries) if (b.companyId === companyId) this.beneficiaries.set(b.id, { ...b, status: "active" });
    for (const i of world.invoices) if (i.companyId === companyId) this.invoices.set(i.id, { status: "not_arrived", flags: [], reasons: [] });
    for (const g of world.grns) if (g.companyId === companyId && !world.grnArrivals.some((x) => x.grnId === g.id)) this.grns.add(g.id);
    this.balance = world.companies.find((c) => c.id === companyId)!.openingBalance;
  }

  addTimer(t: Timer) {
    if (this.timers.some((x) => x.at === t.at && x.kind === t.kind && x.ref === t.ref)) return;
    this.timers.push(t);
    this.timers.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }
  dropTimer(kind: Timer["kind"], ref: string) { this.timers = this.timers.filter((t) => !(t.kind === kind && t.ref === ref)); }

  private inv(id: string) { return this.invoices.get(id)!; }

  apply(e: LedgerEvent) {
    if (e.at > this.cursor) this.cursor = e.at;
    const p = e.payload;
    switch (e.type) {
      // ---- live registry: everything a live company knows arrives through these ----
      case "org_created": this.rp = p.rp; this.founder = p.founder.id; this.world.people.push({ ...p.founder }); break;
      case "person_invited": this.invites.set(p.invite.id, { ...p.invite, status: "open" }); break;
      case "invite_revoked": this.invites.get(p.inviteId)!.status = "revoked"; break;
      case "person_registered": this.world.people.push({ ...p.person }); if (p.inviteId) this.invites.get(p.inviteId)!.status = "used"; break;
      case "passkey_added": { const who = this.world.people.find((x) => x.id === p.personId)!; who.credentials = [...(who.credentials ?? []), p.credential]; break; }
      case "agent_registered": {
        this.world.agents.push({ ...p.agent });
        this.agentStatus.set(p.agent.id, "active");
        if (p.agent.role !== "erp" && !this.policy.allowedModels.includes(p.agent.modelHash)) {
          // Registering an agent is itself an authorised act; its model joins the policy as a new version.
          this.policy = { ...this.policy, version: this.policy.version + 1, allowedModels: [...this.policy.allowedModels, p.agent.modelHash].sort() };
          this.policyHashActive = policyHash(this.policy);
          this.policyLog.push({ version: this.policy.version, hash: this.policyHashActive, at: e.at });
        }
        break;
      }
      case "api_key_rotated": Object.assign(this.world.agents.find((a) => a.id === p.agentId)!, { apiKeyHash: p.apiKeyHash, apiKeyPrefix: p.apiKeyPrefix }); break;
      case "org_sealed": this.sealed = true; break;
      case "sandbox_funded": this.balance += p.amount; break;
      case "sandbox_account_created": this.world.bankDirectory.push({ accountNo: p.accountNo, ifsc: p.ifsc, holder: p.holder }); break;
      case "vendor_registered": this.world.vendors.push({ ...p.vendor }); break;
      case "po_created": this.world.pos.push({ ...p.po }); break;
      case "grn_created": this.world.grns.push({ ...p.grn }); this.grns.add(p.grn.id); break;
      case "invoice_submitted": this.world.invoices.push({ ...p.invoice }); this.invoices.set(p.invoice.id, { status: "not_arrived", flags: [], reasons: [] }); break;
      // ---- shared ----
      case "invoice_received": Object.assign(this.inv(p.invoiceId), { status: "received", flags: p.flags, receivedAt: e.at, reasons: [] }); break;
      case "grn_received": this.grns.add(p.grnId); break;
      case "invoice_held": Object.assign(this.inv(p.invoiceId), { status: "held", reasons: p.reasons, ruleId: e.ruleId }); break;
      case "invoice_rejected": Object.assign(this.inv(p.invoiceId), { status: "rejected", reasons: p.reasons, ruleId: e.ruleId }); break;
      case "invoice_released": Object.assign(this.inv(p.invoiceId), { status: "received", reasons: [] }); break;
      case "msme_alert": this.inv(p.invoiceId).msmeAlerted = true; break;
      case "change_request_opened": this.changeRequests.set(p.request.id, { ...p.request }); break;
      case "penny_drop": this.changeRequests.get(p.requestId)!.penny = { found: p.found, holder: p.holder, score: p.score }; break;
      case "callback_logged": this.changeRequests.get(p.requestId)!.callback = { by: p.by, outcome: p.outcome, at: e.at, number: p.number }; break;
      case "change_request_decided": Object.assign(this.changeRequests.get(p.requestId)!, { status: p.decision, decidedBy: p.by, decidedAt: e.at, reason: p.reason }); break;
      case "beneficiary_added": {
        this.beneficiaries.set(p.beneficiary.id, { ...p.beneficiary, status: "active" });
        const d = istDay(e.at);
        this.newBeneficiariesByDay.set(d, (this.newBeneficiariesByDay.get(d) ?? 0) + 1);
        break;
      }
      case "beneficiary_retired": this.beneficiaries.get(p.beneficiaryId)!.status = "retired"; break;
      case "intent_proposed": {
        this.intents.set(p.intentHash, { intent: p.intent, hash: p.intentHash, attestations: [], approvals: [], status: "attesting", needs: [], needReasons: [], attempt: p.attempt ?? 1 });
        this.intentByInvoice.set(p.intent.invoiceIds[0], p.intentHash);
        for (const id of p.intent.invoiceIds) Object.assign(this.inv(id), { status: "proposed", intentHash: p.intentHash });
        this.nonceCounter = Math.max(this.nonceCounter, p.intent.nonce);
        this.addTimer({ at: p.intent.expiresAt, kind: "expire", ref: p.intentHash });
        break;
      }
      case "attested": this.intents.get(p.intentHash)!.attestations.push(p.attestation); break;
      case "agent_refused": {
        const it = this.intents.get(p.intentHash)!;
        it.attestations.push(p.attestation);
        it.status = "refused";
        this.dropTimer("expire", p.intentHash);
        break;
      }
      case "approval_needed": {
        const it = this.intents.get(p.intentHash)!;
        Object.assign(it, { status: "awaiting_approval", tier: p.tier, needs: p.needs, needReasons: p.reasons });
        for (const id of it.intent.invoiceIds) this.inv(id).status = "awaiting_approval";
        break;
      }
      case "step_up": this.pinFails.delete(p.personId); break;
      case "step_up_failed": this.pinFails.set(p.personId, { count: p.count, lockedUntil: p.lockedUntil }); break;
      case "approved": this.intents.get(p.intentHash)!.approvals.push(p.approval); break;
      case "approval_declined": {
        const it = this.intents.get(p.intentHash)!;
        it.status = "declined";
        this.dropTimer("expire", p.intentHash);
        for (const id of it.intent.invoiceIds) Object.assign(this.inv(id), { status: "held", reasons: [`Declined by ${p.byName}: ${p.reason}`], ruleId: e.ruleId });
        break;
      }
      case "guard_blocked": {
        const it = this.intents.get(p.intentHash);
        if (!it) break; // a forged receipt the guard never planned: logged, nothing to update
        Object.assign(it, { status: "blocked", block: { code: p.code, detail: p.detail, at: e.at }, checks: p.checks });
        if (p.final) {
          this.dropTimer("expire", p.intentHash);
          for (const id of it.intent.invoiceIds) Object.assign(this.inv(id), { status: "held", reasons: [`${p.code}: ${p.detail}`], ruleId: e.ruleId });
        }
        break;
      }
      case "payout_deferred": {
        const it = this.intents.get(p.intentHash)!;
        Object.assign(it, { status: "deferred", deferredUntil: p.until, checks: p.checks ?? it.checks });
        for (const id of it.intent.invoiceIds) this.inv(id).status = "deferred";
        this.addTimer({ at: p.until, kind: "release", ref: p.intentHash });
        break;
      }
      case "payout_submitted": {
        const it = this.intents.get(p.intentHash)!;
        it.status = p.bankStatus === "success" ? "sent" : "pending";
        it.checks = p.checks;
        it.utr = p.utr;
        this.consumedNonces.add(it.intent.nonce);
        this.consumedIntents.add(p.intentHash);
        this.dropTimer("expire", p.intentHash);
        this.dropTimer("release", p.intentHash);
        const d = istDay(e.at);
        this.spentByDay.set(d, (this.spentByDay.get(d) ?? 0) + it.intent.amount);
        if (p.agentOnly) this.agentOnlyByDay.set(d, (this.agentOnlyByDay.get(d) ?? 0) + it.intent.amount);
        this.payouts.push({ vendorId: it.intent.vendorId, at: e.at, amount: it.intent.amount, intentHash: p.intentHash, live: true });
        this.balance -= it.intent.amount;
        this.bankBook.set(p.idemKey, p.bankEntry);
        for (const id of it.intent.invoiceIds) Object.assign(this.inv(id), { status: "paying", reasons: [] });
        if (p.bankStatus !== "success") this.addTimer({ at: addMin(e.at, 5), kind: "poll", ref: p.intentHash });
        break;
      }
      case "payout_settled": {
        const it = this.intents.get(p.intentHash)!;
        it.status = "settled";
        it.utr = p.utr;
        const be = this.bankBook.get(p.idemKey);
        if (be) this.bankBook.set(p.idemKey, { ...be, status: "success", utr: p.utr });
        this.dropTimer("poll", p.intentHash);
        for (const id of it.intent.invoiceIds) Object.assign(this.inv(id), { status: "paid", utr: p.utr, paidAt: e.at });
        break;
      }
      case "payout_failed": {
        const it = this.intents.get(p.intentHash)!;
        it.status = "failed";
        const d = istDay(p.submittedAt);
        this.spentByDay.set(d, (this.spentByDay.get(d) ?? 0) - it.intent.amount);
        if (p.agentOnly) this.agentOnlyByDay.set(d, (this.agentOnlyByDay.get(d) ?? 0) - it.intent.amount);
        const po = this.payouts.find((x) => x.intentHash === p.intentHash);
        if (po) po.live = false;
        this.balance += it.intent.amount;
        const be = this.bankBook.get(p.idemKey);
        if (be) this.bankBook.set(p.idemKey, { ...be, status: "failed" });
        this.dropTimer("poll", p.intentHash);
        for (const id of it.intent.invoiceIds) Object.assign(this.inv(id), { status: "received", reasons: [`Bank: ${p.reason}`] });
        this.addTimer({ at: p.retryAt, kind: "retry", ref: it.intent.invoiceIds[0] });
        break;
      }
      case "status_checked":
        this.dropTimer("poll", p.intentHash);
        if (p.status === "pending") this.addTimer({ at: addMin(e.at, 5), kind: "poll", ref: p.intentHash });
        break;
      case "intent_expired": {
        const it = this.intents.get(p.intentHash)!;
        it.status = "expired";
        this.dropTimer("expire", p.intentHash);
        this.dropTimer("release", p.intentHash);
        for (const id of it.intent.invoiceIds) Object.assign(this.inv(id), { status: "received", reasons: ["Plan expired before release; planned again"] });
        break;
      }
      case "case_opened": this.cases.set(p.case.id, { ...p.case }); break;
      case "case_closed": this.cases.get(p.caseId)!.status = "closed"; break;
      case "stopped": this.stopped.push({ invoiceId: p.invoiceId, requestId: p.requestId, amount: p.amount, reason: p.reason }); break;
      case "policy_proposed": this.proposals.set(p.proposal.id, { ...p.proposal, sigs: { ...p.proposal.sigs } }); break;
      case "policy_signed": this.proposals.get(p.proposalId)!.sigs[p.by] = p.sig; break;
      case "policy_scheduled": {
        Object.assign(this.proposals.get(p.proposalId)!, { status: "scheduled", effectiveAt: p.effectiveAt });
        this.addTimer({ at: p.effectiveAt, kind: "activate", ref: p.proposalId });
        break;
      }
      case "proposal_executed": this.proposals.get(p.proposalId)!.status = "active"; break;
      case "policy_vetoed": Object.assign(this.proposals.get(p.proposalId)!, { status: "vetoed", vetoedBy: p.by }); this.dropTimer("activate", p.proposalId); break;
      case "policy_activated": {
        const pr = this.proposals.get(p.proposalId)!;
        pr.status = "active";
        for (const o of this.proposals.values()) if (o !== pr && o.kind === "policy" && o.status === "active") o.status = "superseded";
        this.policy = pr.policy;
        this.policyHashActive = policyHash(pr.policy);
        this.policyLog.push({ version: pr.policy.version, hash: this.policyHashActive, at: e.at });
        this.dropTimer("activate", p.proposalId);
        break;
      }
      case "freeze": this.frozen = p.on ? { on: true, by: p.by, at: e.at, reason: p.reason } : { on: false }; break;
      case "agent_suspended": this.agentStatus.set(p.agentId, "suspended"); break;
      case "agent_reinstated": this.agentStatus.set(p.agentId, "active"); break;
      case "command_refused": this.refusedCommands++; break;
    }
  }

  /** Live payouts to a vendor inside the 24 hours before `at`. */
  vendorWindow(vendorId: string, at: ISO): Paise {
    const from = new Date(new Date(at).getTime() - 24 * 3_600_000).toISOString();
    return this.payouts.filter((x) => x.live && x.vendorId === vendorId && x.at > from && x.at <= at).reduce((s, x) => s + x.amount, 0);
  }
  vendorCountToday(vendorId: string, at: ISO): number {
    const d = istDay(at);
    return this.payouts.filter((x) => x.live && x.vendorId === vendorId && istDay(x.at) === d).length;
  }
  activeBeneficiary(vendorId: string, at: ISO): BeneficiaryState | undefined {
    return [...this.beneficiaries.values()].filter((b) => b.vendorId === vendorId && b.status === "active" && b.addedAt <= at).sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))[0];
  }
}

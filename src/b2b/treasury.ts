// src/b2b/treasury.ts: one company's treasury: its world, its hash-chained ledger and the state replayed from it.
// advance(to) runs everything time-driven in order (invoices arriving, receipts, timers, the team's scripted
// habits); command() is how people act. Both reach money only through release(), which asks the guard.
import { istDay } from "@/engine/clock";
import { complianceFindings, propose, runCompliance, runRisk } from "./agents";
import { addMin, B2B_END, B2B_START, daysBetween, ist, ms, nextReleaseOpen } from "./clock";
import { canonical } from "./crypto";
import { payoutRule, RULE_FOR_CODE, submitToBank, verifyReceipt, type GuardVerdict } from "./guard";
import { readInvoiceEmail } from "./intake";
import { eventHash, GENESIS } from "./ledger";
import type { B2BRuleId } from "./rules";
import { nameMatch, pennyDrop, status as bankStatus, utrFor } from "./sim/bank";
import { TreasuryState, type ChangeRequest } from "./state";
import { accountHash } from "./crypto";
import type { Actor, BusinessWorld, ISO, LedgerEvent, Receipt } from "./types";
import { scenarioFor } from "./scenario";
import { applyCommand, type B2BCommand, type CommandResult } from "./commands";

export interface NewLedgerEvent { at: ISO; type: string; actor: Actor; ruleId?: B2BRuleId; payload: Record<string, unknown> }
interface Job { at: ISO; pri: number; kind: "arrive" | "grn" | "msme" | "anchor" | "script" | "onboard"; ref: string }

const jobCache = new WeakMap<BusinessWorld, Map<string, Job[]>>();

export class Treasury {
  events: LedgerEvent[] = [];
  state: TreasuryState;
  processedTo: ISO = B2B_START;
  /** Red-team and demo switches: an agent that has been taken over signs whatever it is shown. */
  compromised = { proposer: false, compliance: false, risk: false };
  autoplay: boolean;
  private replans = new Map<string, number>();

  constructor(public world: BusinessWorld, public companyId: string, opts: { autoplay?: boolean } = {}) {
    this.state = new TreasuryState(world, companyId, B2B_START);
    this.autoplay = opts.autoplay ?? true;
  }

  get head() { return this.events.at(-1)?.hash ?? GENESIS; }

  emit(e: NewLedgerEvent): LedgerEvent {
    const base = { seq: this.events.length + 1, at: e.at, companyId: this.companyId, type: e.type, actor: e.actor, ruleId: e.ruleId, payload: JSON.parse(canonical(e.payload)), prev: this.head };
    const full: LedgerEvent = { ...base, hash: eventHash(base) };
    this.events.push(full);
    this.state.apply(full);
    return full;
  }

  private jobs(): Job[] {
    let byCo = jobCache.get(this.world);
    if (!byCo) { byCo = new Map(); jobCache.set(this.world, byCo); }
    const hit = byCo.get(this.companyId);
    if (hit) return hit;
    const jobs: Job[] = [];
    for (const i of this.world.invoices) if (i.companyId === this.companyId) jobs.push({ at: i.arrivesAt, pri: 3, kind: "arrive", ref: i.id });
    for (const g of this.world.grnArrivals) if (this.world.grns.find((x) => x.id === g.grnId)?.companyId === this.companyId) jobs.push({ at: g.at, pri: 1, kind: "grn", ref: g.grnId });
    for (const o of this.world.vendorOnboarding) if (this.world.vendors.find((v) => v.id === o.vendorId)?.companyId === this.companyId) jobs.push({ at: o.at, pri: 1, kind: "onboard", ref: o.vendorId });
    for (const d of ["2026-10-26", "2026-10-27", "2026-10-28"]) {
      jobs.push({ at: ist(`${d} 08:50`), pri: 0, kind: "msme", ref: d });
      jobs.push({ at: ist(`${d} 23:59`), pri: 9, kind: "anchor", ref: d });
    }
    scenarioFor(this.world).forEach((s, i) => { if (s.companyId === this.companyId) jobs.push({ at: s.at, pri: 5, kind: "script", ref: String(i) }); });
    jobs.sort((a, b) => ms(a.at) - ms(b.at) || a.pri - b.pri || (a.ref < b.ref ? -1 : 1));
    byCo.set(this.companyId, jobs);
    return jobs;
  }

  /** Run every job and timer due in (processedTo, to], in time order. Safe to call repeatedly. */
  advance(to: ISO) {
    if (to > B2B_END) to = B2B_END;
    if (to <= this.processedTo) return;
    const jobs = this.jobs();
    let i = jobs.findIndex((j) => j.at > this.processedTo);
    if (i < 0) i = jobs.length;
    for (let guard = 0; guard < 100_000; guard++) {
      const job = i < jobs.length && jobs[i].at <= to ? jobs[i] : undefined;
      const timer = this.state.timers.find((t) => t.at <= to);
      if (!job && !timer) break;
      if (timer && (!job || timer.at <= job.at)) {
        this.state.timers = this.state.timers.filter((t) => t !== timer);
        this.processedTo = timer.at > this.processedTo ? timer.at : this.processedTo;
        this.onTimer(timer.kind, timer.ref, timer.at);
      } else if (job) {
        i++;
        this.processedTo = job.at;
        this.onJob(job);
      }
    }
    this.processedTo = to;
  }

  /** Demo and red-team switch: from `at`, the named agents sign whatever they are shown. Written to the ledger
   *  so a replay takes the same path. */
  simulateTakeover(at: ISO, compromised: Treasury["compromised"]) {
    this.advance(at);
    this.compromised = { ...compromised };
    this.emit({ at, type: "takeover_simulated", actor: "system", payload: { ...compromised } });
  }

  command(at: ISO, cmd: B2BCommand): CommandResult {
    this.advance(at);
    return applyCommand(this, at, cmd);
  }

  private onJob(j: Job) {
    switch (j.kind) {
      case "arrive": return this.arrive(j.ref, j.at);
      case "grn": {
        this.emit({ at: j.at, type: "grn_received", actor: "system", payload: { grnId: j.ref } });
        const grn = this.world.grns.find((g) => g.id === j.ref)!;
        for (const inv of this.world.invoices.filter((x) => x.poId === grn.poId)) {
          const s = this.state.invoices.get(inv.id)!;
          if (s.status === "held" && s.reasons.some((r) => r.includes("goods receipt"))) {
            this.emit({ at: j.at, type: "invoice_released", actor: "system", ruleId: "HOLD_MATCH_V1", payload: { invoiceId: inv.id, why: "Goods receipt arrived" } });
            this.process(inv.id, j.at);
          }
        }
        return;
      }
      case "msme": return this.msmeSweep(j.at);
      case "onboard": {
        const b = this.world.beneficiaries.find((x) => x.vendorId === j.ref)!;
        this.emit({ at: j.at, type: "vendor_onboarded", actor: "person", ruleId: "COOLING_V1", payload: { vendorId: j.ref, beneficiaryId: b.id, approvedBy: b.approvedBy, usableFrom: addMin(j.at, this.state.policy.coolingHoursNew * 60) } });
        return;
      }
      case "anchor": return void this.emit({ at: j.at, type: "anchor", actor: "system", payload: { day: j.ref, head: this.head, events: this.events.length } });
      case "script": {
        if (!this.autoplay) return;
        const s = scenarioFor(this.world)[Number(j.ref)];
        applyCommand(this, j.at, { ...s.cmd, autoplayed: true } as B2BCommand);
        return;
      }
    }
  }

  private onTimer(kind: string, ref: string, at: ISO) {
    const st = this.state;
    if (kind === "release") return this.release(ref, at);
    if (kind === "retry") {
      const last = st.intentByInvoice.get(ref);
      return this.process(ref, at, (last ? st.intents.get(last)!.attempt : 0) + 1);
    }
    if (kind === "activate") {
      const p = st.proposals.get(ref);
      if (p?.status !== "scheduled") return;
      this.emit({ at, type: "policy_activated", actor: "system", ruleId: "TIMELOCK_V1", payload: { proposalId: ref, version: p.policy.version, hash: p.hash } });
      this.replanAll(at, `Policy v${p.policy.version} is now active`);
      return;
    }
    if (kind === "expire") {
      const it = st.intents.get(ref);
      if (!it || !["attesting", "awaiting_approval", "deferred", "blocked"].includes(it.status) || (it.status === "blocked" && !["NOT_FROZEN", "FUNDS", "NO_OPEN_BANK_CHANGE"].includes(it.block?.code ?? ""))) return;
      this.emit({ at, type: "intent_expired", actor: "guard", ruleId: "RECEIPT_V1", payload: { intentHash: ref, why: "Not released within its lifetime" } });
      this.process(it.intent.invoiceIds[0], at, it.attempt);
      return;
    }
    if (kind === "poll") {
      const it = st.intents.get(ref);
      if (!it || it.status !== "pending") return;
      const entry = st.bankBook.get(ref)!;
      const s = bankStatus(entry, at);
      if (s === "success") this.emit({ at, type: "payout_settled", actor: "bank", ruleId: "BANK_STATUS_V1", payload: { intentHash: ref, idemKey: ref, utr: utrFor(ref) } });
      else this.emit({ at, type: "status_checked", actor: "guard", ruleId: "BANK_STATUS_V1", payload: { intentHash: ref, status: s } });
    }
  }

  /** Intents signed under an older policy cannot be released; plan them again under the current one. */
  replanAll(at: ISO, why: string) {
    for (const it of [...this.state.intents.values()]) {
      if (!["awaiting_approval", "deferred"].includes(it.status) || it.intent.policyHash === this.state.policyHashActive) continue;
      this.emit({ at, type: "intent_expired", actor: "guard", ruleId: "RECEIPT_V1", payload: { intentHash: it.hash, why } });
      this.process(it.intent.invoiceIds[0], at, it.attempt);
    }
  }

  private arrive(invoiceId: string, at: ISO) {
    const inv = this.world.invoices.find((i) => i.id === invoiceId)!;
    const vendor = this.world.vendors.find((v) => v.id === inv.vendorId)!;
    const r = readInvoiceEmail(inv, vendor);
    this.emit({ at, type: "invoice_received", actor: "vendor", payload: { invoiceId, number: inv.number, vendorId: vendor.id, total: inv.total, flags: r.flags, evidence: r.evidence, reader: r.reader } });
    if (r.flags.includes("INJECTION")) {
      this.emit({ at, type: "quarantined", actor: "agent", ruleId: "INJECTION_QUARANTINE_V1", payload: { invoiceId, evidence: r.evidence.filter((x) => x.startsWith("INJECTION")), note: "Text addressed to the AI was treated as data. No instruction in it was followed." } });
    }
    if (r.bankChange) this.openChangeRequest(at, { id: `cr_${invoiceId}`, vendorId: vendor.id, source: "email", accountNo: r.bankChange.accountNo, ifsc: r.bankChange.ifsc, holderClaimed: r.bankChange.holderClaimed, openedBy: "a_intake", invoiceId });
    this.process(invoiceId, at);
  }

  openChangeRequest(at: ISO, c: Omit<ChangeRequest, "accountHash" | "openedAt" | "status">) {
    const request: ChangeRequest = { ...c, accountHash: accountHash(c.ifsc, c.accountNo), openedAt: at, status: "open" };
    this.emit({ at, type: "change_request_opened", actor: c.source === "email" ? "agent" : c.openedBy.startsWith("p_") ? "person" : "vendor", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { request } });
    const vendor = this.world.vendors.find((v) => v.id === c.vendorId)!;
    const pd = pennyDrop(this.world, c.ifsc, c.accountNo);
    const score = pd.holder ? nameMatch(vendor.legalName, pd.holder) : 0;
    this.emit({ at: addMin(at, 1), type: "penny_drop", actor: "bank", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { requestId: c.id, found: pd.found, holder: pd.holder, score } });
  }

  private msmeSweep(at: ISO) {
    for (const inv of this.world.invoices) {
      if (inv.companyId !== this.companyId) continue;
      const v = this.world.vendors.find((x) => x.id === inv.vendorId)!;
      const s = this.state.invoices.get(inv.id)!;
      if (!v.msme || s.status === "paid" || s.status === "rejected" || s.status === "not_arrived" || s.msmeAlerted) continue;
      const age = daysBetween(inv.date, at);
      if (age >= this.state.policy.msmeDays - 5) this.emit({ at, type: "msme_alert", actor: "system", ruleId: "MSME_45_V1", payload: { invoiceId: inv.id, age, dueBy: addMin(inv.date, this.state.policy.msmeDays * 1440) } });
    }
  }

  /** Plan, attest and try to release one invoice. */
  process(invoiceId: string, at: ISO, attempt = 1) {
    const st = this.state;
    const s = st.invoices.get(invoiceId)!;
    if (!["received"].includes(s.status)) return;
    // Fail safe: an invoice planned again and again at the same instant means something is wrong. Hold it.
    const key = `${invoiceId}|${at}`;
    this.replans.set(key, (this.replans.get(key) ?? 0) + 1);
    if (this.replans.get(key)! > 3) {
      this.emit({ at, type: "invoice_held", actor: "guard", ruleId: "RECEIPT_V1", payload: { invoiceId, reasons: ["Planned too many times at once; held for a person"] } });
      return;
    }
    const inv = this.world.invoices.find((i) => i.id === invoiceId)!;
    const grn = this.world.grns.find((g) => g.poId === inv.poId && st.grns.has(g.id));
    if (!grn) {
      this.emit({ at, type: "invoice_held", actor: "agent", ruleId: "HOLD_MATCH_V1", payload: { invoiceId, reasons: ["Waiting for the goods receipt"] } });
      return;
    }
    const hash = propose(this, invoiceId, at, attempt);
    if (!hash) return;
    const findings = runCompliance(this, hash, at);
    const it = st.intents.get(hash)!;
    if (findings.length && it.status === "refused") {
      const real = complianceFindings(this, it.intent, at);
      const dup = real.find((f) => f.code === "DUPLICATE");
      const rule: B2BRuleId = dup ? "HOLD_DUPLICATE_V1" : real.some((f) => f.code.startsWith("GSTIN")) ? "HOLD_GSTIN_V1" : real.some((f) => f.code === "MATCH") ? "HOLD_MATCH_V1" : "RECEIPT_V1";
      this.emit({ at, type: dup ? "invoice_rejected" : "invoice_held", actor: "agent", ruleId: rule, payload: { invoiceId, reasons: real.map((f) => f.detail) } });
      if (dup) this.emit({ at, type: "stopped", actor: "agent", ruleId: rule, payload: { invoiceId, amount: it.intent.amount, reason: "Duplicate invoice" } });
      if (real.some((f) => f.code === "MATCH")) this.openCase(at, "mismatch", inv.vendorId, invoiceId, it.intent.amount, `Invoice ${inv.number} does not match the goods received`);
      return;
    }
    runRisk(this, hash, at);
    if (st.intents.get(hash)!.status === "refused") {
      this.emit({ at, type: "invoice_held", actor: "agent", ruleId: "RECEIPT_V1", payload: { invoiceId, reasons: ["Risk agent refused to sign"] } });
      return;
    }
    this.release(hash, at);
  }

  openCase(at: ISO, kind: "fraud_attempt" | "mismatch" | "bank_failure", vendorId: string, invoiceId: string | undefined, amount: number, summary: string, requestId?: string) {
    const id = `BIZ-${4400 + this.state.cases.size + 1}`;
    this.emit({ at, type: "case_opened", actor: "system", ruleId: kind === "fraud_attempt" ? "BANK_CHANGE_VERIFY_V1" : kind === "mismatch" ? "HOLD_MATCH_V1" : "BANK_STATUS_V1", payload: { case: { id, kind, vendorId, invoiceId, requestId, amount, summary, openedAt: at, status: "open" } } });
    return id;
  }

  receipt(hash: string): Receipt {
    const it = this.state.intents.get(hash)!;
    return { intent: it.intent, attestations: it.attestations, approvals: it.approvals };
  }

  check(hash: string, at: ISO): GuardVerdict {
    return verifyReceipt({ world: this.world, state: this.state, companyId: this.companyId }, this.receipt(hash), at);
  }

  /** The one path to the bank. */
  release(hash: string, at: ISO) {
    const st = this.state;
    const it = st.intents.get(hash);
    if (!it || !["attesting", "awaiting_approval", "deferred", "blocked"].includes(it.status)) return;
    const ctx = { world: this.world, state: st, companyId: this.companyId };
    const v = verifyReceipt(ctx, this.receipt(hash), at);
    const checks = v.checks.map((c) => ({ code: c.code, ok: c.ok, ...(c.ok || !c.detail ? {} : { detail: c.detail }) }));
    if (v.outcome === "block") {
      this.emit({ at, type: "guard_blocked", actor: "guard", ruleId: RULE_FOR_CODE[v.code!] ?? "RECEIPT_V1", payload: { intentHash: hash, code: v.code, detail: v.detail ?? "", final: v.final, checks } });
      if (v.final && (v.code === "POLICY_CURRENT" || v.code === "NOT_EXPIRED")) {
        this.emit({ at, type: "intent_expired", actor: "guard", ruleId: "RECEIPT_V1", payload: { intentHash: hash, why: v.detail } });
        this.process(it.intent.invoiceIds[0], at, it.attempt);
      }
      return;
    }
    if (v.outcome === "needs_approval") {
      if (it.status !== "awaiting_approval" || canonical(it.needs) !== canonical(v.needs)) {
        this.emit({ at, type: "approval_needed", actor: "guard", ruleId: v.tier === "checker_cfo" ? "PAYOUT_CFO_V1" : "PAYOUT_CHECKER_V1", payload: { intentHash: hash, tier: v.tier, needs: v.needs, reasons: v.needReasons, checks } });
      }
      return;
    }
    if (v.outcome === "defer") {
      if (it.status !== "deferred" || it.deferredUntil !== v.deferUntil) this.emit({ at, type: "payout_deferred", actor: "guard", ruleId: RULE_FOR_CODE[v.code!] ?? "RELEASE_WINDOW_V1", payload: { intentHash: hash, until: v.deferUntil, code: v.code, detail: v.detail ?? "", checks } });
      return;
    }
    const sub = submitToBank(ctx, this.receipt(hash), at, it.attempt);
    if (sub.duplicate) {
      this.emit({ at, type: "guard_blocked", actor: "bank", ruleId: "BANK_STATUS_V1", payload: { intentHash: hash, code: "BANK_DUPLICATE", detail: "The bank already has this payout", final: true, checks } });
      return;
    }
    const e = sub.entry;
    this.emit({ at, type: "payout_submitted", actor: "guard", ruleId: payoutRule(v.tier), payload: { intentHash: hash, idemKey: e.idemKey, amount: it.intent.amount, rail: it.intent.rail, nonce: it.intent.nonce, tier: v.tier, agentOnly: v.agentOnly, bankStatus: e.status, utr: e.utr ?? null, bankEntry: { ...e, utr: e.utr ?? null }, checks, money: true } });
    if (e.status === "success") this.emit({ at, type: "payout_settled", actor: "bank", ruleId: payoutRule(v.tier), payload: { intentHash: hash, idemKey: e.idemKey, utr: e.utr } });
    else if (e.status === "failed") {
      const retryAt = nextReleaseOpen(addMin(at, 30), st.policy.releaseStartMin, st.policy.releaseEndMin);
      this.emit({ at, type: "payout_failed", actor: "bank", ruleId: "RETRY_AFTER_FAIL_V1", payload: { intentHash: hash, idemKey: e.idemKey, reason: "Beneficiary bank not reachable", submittedAt: at, agentOnly: v.agentOnly, retryAt } });
    }
  }

  /** Re-check every intent waiting on something a command may have changed (unfreeze, a new approval). */
  retryWaiting(at: ISO) {
    for (const it of [...this.state.intents.values()]) {
      if (it.status === "blocked" && it.block && ["NOT_FROZEN", "FUNDS", "NO_OPEN_BANK_CHANGE"].includes(it.block.code)) this.release(it.hash, at);
      else if (it.status === "deferred" && it.deferredUntil && it.deferredUntil <= at) this.release(it.hash, at);
    }
  }

  dayKey(at: ISO) { return istDay(at); }
}

export const B2B_DEFAULT_END = B2B_END;

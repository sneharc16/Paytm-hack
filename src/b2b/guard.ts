// src/b2b/guard.ts: the treasury guard. The only code that can submit a payout to the bank, and it does so only
// for a receipt it can check end to end on its own: the intent, three agent signatures, the people's signatures
// the policy demands, and the company's current state. It trusts no agent, no host and no email. Any error
// while checking is a "no" (fail closed). It can verify signatures but cannot make them: it never imports keys.ts.
import { istDay } from "@/engine/clock";
import { inr } from "@/lib/format";
import { approveMessage, attestMessage, verifyPersonSig, verifySig } from "./crypto";
import { hoursBetween, inReleaseWindow, nextIstMidnight, nextReleaseOpen } from "./clock";
import { IntentSchema, intentHash } from "./intent";
import { rolesFor, tdsOn, tierFor, type Tier } from "./policy";
import type { B2BRuleId } from "./rules";
import * as bank from "./sim/bank";
import type { TreasuryState } from "./state";
import type { AgentRole, BusinessWorld, ISO, Receipt } from "./types";

export interface Check { code: string; ok: boolean; detail?: string }
export type Outcome = "release" | "defer" | "needs_approval" | "block";
export interface GuardVerdict {
  outcome: Outcome; checks: Check[]; code?: string; detail?: string; final: boolean;
  tier: Tier; needs: ("checker" | "cfo")[]; needReasons: string[]; deferUntil?: ISO; agentOnly: boolean; hash: string;
}
export interface GuardContext { world: BusinessWorld; state: TreasuryState; companyId: string }

/** Codes that stop a payout for good. Anything else (freeze, window, cooling, limits, missing approvals) waits. */
const DEFERRABLE = new Set(["COOLING", "RELEASE_WINDOW", "DAILY_LIMIT", "VELOCITY"]);
const RETRYABLE = new Set(["NOT_FROZEN", "FUNDS", "NO_OPEN_BANK_CHANGE", "ORG_SEALED"]);

export function verifyReceipt(ctx: GuardContext, r: Receipt, at: ISO): GuardVerdict {
  const checks: Check[] = [];
  const add = (code: string, ok: boolean, detail?: string) => { checks.push({ code, ok, detail }); return ok; };
  const base = { tier: "agents" as Tier, needs: [] as ("checker" | "cfo")[], needReasons: [] as string[], agentOnly: false };
  let hash = "";
  try {
    const { state: st, world: w, companyId } = ctx;
    const pol = st.policy;
    add("NOT_FROZEN", !st.frozen.on, st.frozen.on ? `Frozen by ${st.frozen.by}: ${st.frozen.reason}` : undefined);
    add("ORG_SEALED", st.sealed, st.sealed ? undefined : "Setup is not sealed yet: no payouts until three governors, a maker, a checker, a CFO and three agents are in place");

    const parsed = IntentSchema.safeParse(r?.intent);
    if (!parsed.success) {
      add("WELL_FORMED", false, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 200));
      return finish(checks, base, hash, at);
    }
    add("WELL_FORMED", true);
    const it = parsed.data;
    hash = intentHash(it);
    add("TENANT", it.companyId === companyId, it.companyId === companyId ? undefined : `Intent is for ${it.companyId}, this treasury is ${companyId}`);
    const planned = st.intents.get(hash);
    add("PLANNED_IN_LEDGER", !!planned, planned ? undefined : "No intent with this hash was planned in this company's ledger");
    add("NOT_REPLAYED", !st.consumedIntents.has(hash) && !st.consumedNonces.has(it.nonce), st.consumedIntents.has(hash) ? "This intent was already paid" : st.consumedNonces.has(it.nonce) ? `Nonce ${it.nonce} already used` : undefined);
    add("NONCE_ISSUED", it.nonce <= st.nonceCounter, it.nonce <= st.nonceCounter ? undefined : `Nonce ${it.nonce} was never issued`);
    const ttl = hoursBetween(it.createdAt, it.expiresAt) * 60;
    add("NOT_EXPIRED", it.createdAt <= at && at < it.expiresAt && ttl <= pol.intentTtlMinutes, at >= it.expiresAt ? "Intent expired" : ttl > pol.intentTtlMinutes ? "Intent lifetime longer than policy allows" : it.createdAt > at ? "Intent dated in the future" : undefined);
    add("POLICY_CURRENT", it.policyHash === st.policyHashActive && it.policyVersion === pol.version, it.policyHash === st.policyHashActive ? undefined : `Signed under policy v${it.policyVersion}, active is v${pol.version}`);

    // Agent quorum: one valid signature per role, from an active agent of this company.
    const verdicts: Partial<Record<AgentRole, { verdict: string; reasons: string[] }>> = {};
    const seen = new Set<string>();
    const sigProblems: string[] = [];
    for (const a of r.attestations ?? []) {
      const agent = w.agents.find((x) => x.id === a.signerId);
      if (!agent || agent.companyId !== companyId) { sigProblems.push(`${a.signerId}: not an agent of this company`); continue; }
      if (agent.role !== a.role) { sigProblems.push(`${a.signerId}: signed as ${a.role}, registered as ${agent.role}`); continue; }
      if (st.agentStatus.get(agent.id) !== "active") { sigProblems.push(`${a.signerId}: key suspended`); continue; }
      if (a.intentHash !== hash) { sigProblems.push(`${a.signerId}: signed a different intent`); continue; }
      if (!verifySig(agent.publicKey, attestMessage(a), a.sig)) { sigProblems.push(`${a.signerId}: signature does not verify`); continue; }
      if (a.signedAt < it.createdAt || a.signedAt > at) { sigProblems.push(`${a.signerId}: signed outside the intent's life`); continue; }
      if (seen.has(agent.id) || verdicts[agent.role]) { sigProblems.push(`${a.signerId}: second signature for ${agent.role}`); continue; }
      seen.add(agent.id);
      verdicts[agent.role] = { verdict: a.verdict, reasons: a.reasons };
    }
    add("SIGNATURES_VALID", sigProblems.length === 0, sigProblems.join("; ").slice(0, 300) || undefined);
    const missing = (["proposer", "compliance", "risk"] as AgentRole[]).filter((x) => !verdicts[x]);
    add("AGENT_QUORUM", missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : undefined);
    const rejecters = Object.entries(verdicts).filter(([, v]) => v!.verdict === "reject").map(([k, v]) => `${k}: ${v!.reasons.join(", ")}`);
    add("NO_AGENT_REJECTED", rejecters.length === 0, rejecters.join("; ") || undefined);
    const proposer = w.agents.find((x) => x.companyId === companyId && x.role === "proposer");
    add("MODEL_ALLOWED", pol.allowedModels.includes(it.modelHash) && proposer?.modelHash === it.modelHash, pol.allowedModels.includes(it.modelHash) ? undefined : "Model is not on the policy's list");

    // Payee: the account must be exactly the active, approved account on file for this vendor.
    const vendor = w.vendors.find((v) => v.id === it.vendorId && v.companyId === companyId);
    const ben = st.beneficiaries.get(it.beneficiaryId);
    const benOk = !!vendor && !!ben && ben.companyId === companyId && ben.vendorId === it.vendorId && ben.status === "active" && ben.addedAt <= at;
    add("PAYEE_ON_FILE", benOk, !vendor ? "Unknown vendor" : !ben ? "Unknown bank account" : ben.status !== "active" ? `Account ${ben.status}` : ben.vendorId !== it.vendorId ? "Account belongs to another vendor" : undefined);
    add("ACCOUNT_BOUND", !!ben && ben.accountHash === it.accountHash, ben && ben.accountHash !== it.accountHash ? "Account in the intent is not the account on file" : undefined);

    // Invoices: open, this vendor's, planned under this intent, and the amount is exactly what is owed.
    let owed = 0, tds = 0;
    const invProblems: string[] = [];
    for (const id of it.invoiceIds) {
      const inv = w.invoices.find((x) => x.id === id);
      const s = st.invoices.get(id);
      if (!inv || inv.companyId !== companyId || inv.vendorId !== it.vendorId) { invProblems.push(`${id}: not this vendor's invoice`); continue; }
      if (!s || !["proposed", "awaiting_approval", "deferred"].includes(s.status) || s.intentHash !== hash) { invProblems.push(`${inv.number}: ${s?.status ?? "unknown"}, not open for this intent`); continue; }
      owed += inv.total;
      tds += vendor ? tdsOn(pol, vendor.category, inv.taxable) : 0;
    }
    if (new Set(it.invoiceIds).size !== it.invoiceIds.length) invProblems.push("Same invoice listed twice");
    add("INVOICES_OPEN", invProblems.length === 0, invProblems.join("; ") || undefined);
    add("AMOUNT_EXACT", it.amount + it.tds === owed && it.tds === tds, it.amount + it.tds !== owed ? `Pays ${it.amount + it.tds}, invoices total ${owed}` : it.tds !== tds ? `TDS ${it.tds}, policy says ${tds}` : undefined);

    // While someone is asking to change this vendor's bank details, nothing is paid to the vendor at all.
    const openChange = [...st.changeRequests.values()].find((c) => c.vendorId === it.vendorId && c.status === "open");
    add("NO_OPEN_BANK_CHANGE", !openChange, openChange ? `Bank change request ${openChange.id} is open; payouts wait for the callback` : undefined);

    // Limits and rails.
    add("PER_TXN_CAP", it.amount <= pol.perTxnCap);
    const rail = pol.rails[it.rail];
    add("RAIL_FITS", it.amount >= rail.min && (rail.max === null || it.amount <= rail.max), `${it.rail} takes ${rail.min} to ${rail.max ?? "any"}`);
    // An account added recently and never paid from this ledger is a "first payout". Older accounts were paid
    // before the ledger began.
    const recent = !!ben && hoursBetween(ben.addedAt, at) <= pol.sodLookbackDays * 24;
    const firstToAccount = recent && !st.payouts.some((p) => p.live && st.intents.get(p.intentHash)?.intent.accountHash === it.accountHash);
    add("FIRST_PAYMENT_CAP", !firstToAccount || it.amount <= pol.firstPaymentCap, firstToAccount ? "First payout to this account" : undefined);

    // Who must approve: decided here from the ledger, never taken from the intent.
    const forced: string[] = [];
    if (verdicts.risk?.verdict === "escalate") forced.push(`Risk agent: ${verdicts.risk.reasons.join(", ")}`);
    if (firstToAccount) forced.push("First payout to this account");
    const flagged = it.invoiceIds.flatMap((id) => st.invoices.get(id)?.flags ?? []);
    if (flagged.length) forced.push(`Email flags: ${[...new Set(flagged)].join(", ")}`);
    const aggregate = st.vendorWindow(it.vendorId, at) + it.amount;
    let tier = tierFor(pol, aggregate, forced.length > 0);
    const reasons = [...forced];
    if (aggregate > it.amount && aggregate >= pol.checkerFrom && it.amount < pol.checkerFrom) reasons.push(`With the last 24 hours this vendor gets ${inr(aggregate)} (STRUCTURING_V1)`);
    else if (tier === "checker_cfo") reasons.push(`${inr(aggregate)} is at or above the CFO line of ${inr(pol.cfoFrom)}`);
    else if (tier === "checker" && !forced.length) reasons.push(`${inr(aggregate)} is at or above the checker line of ${inr(pol.checkerFrom)}`);
    const day = istDay(at);
    if (tier === "agents" && (st.agentOnlyByDay.get(day) ?? 0) + it.amount > pol.agentOnlyDailyCap) { tier = "checker"; reasons.push("Agents' own daily cap reached (AGENT_CAP_V1)"); }
    const needs = rolesFor(tier);
    const v = { tier, needs, needReasons: reasons, agentOnly: tier === "agents" };

    // People: valid signatures, right roles, within their life, and segregation of duties.
    const used = new Set<string>();
    const apProblems: string[] = [];
    const have = new Set<string>();
    for (const ap of r.approvals ?? []) {
      const person = w.people.find((x) => x.id === ap.personId);
      if (!person || person.companyId !== companyId) { apProblems.push(`${ap.personId}: not in this company`); continue; }
      if (!person.roles.includes(ap.role)) { apProblems.push(`${person.name}: not a ${ap.role}`); continue; }
      if (ap.intentHash !== hash || ap.companyId !== companyId) { apProblems.push(`${person.name}: approved a different intent`); continue; }
      if (!verifyPersonSig(person, approveMessage(ap), ap, st.rp, st.requirePasskey)) { apProblems.push(`${person.name}: ${st.requirePasskey && !ap.webauthn ? "not signed with a passkey" : "signature does not verify"}`); continue; }
      if (ap.at < it.createdAt || ap.at > at || hoursBetween(ap.at, at) * 60 > pol.approvalTtlMinutes) { apProblems.push(`${person.name}: approval outside its time`); continue; }
      if (person.id === it.preparedFor) { apProblems.push(`${person.name}: prepared this payout (SOD_V1)`); continue; }
      if (ben && ben.addedVia === "change_request" && ben.approvedBy === person.id && hoursBetween(ben.addedAt, at) <= pol.sodLookbackDays * 24) { apProblems.push(`${person.name}: approved this bank account (SOD_V1)`); continue; }
      if (used.has(person.id)) { apProblems.push(`${person.name}: already signed in another role (SOD_V1)`); continue; }
      used.add(person.id);
      have.add(ap.role);
    }
    add("APPROVALS_VALID", apProblems.length === 0, apProblems.join("; ") || undefined);
    const lacking = needs.filter((x) => !have.has(x));
    add("APPROVALS_COMPLETE", lacking.length === 0, lacking.length ? `Needs ${lacking.join(" and ")}: ${reasons.join("; ")}` : undefined);

    // Things that only wait.
    const coolH = ben ? (ben.addedVia === "change_request" ? pol.coolingHoursChanged : pol.coolingHoursNew) : 0;
    const coolEnd = ben ? new Date(new Date(ben.addedAt).getTime() + coolH * 3_600_000).toISOString() : at;
    add("COOLING", !ben || at >= coolEnd, at < coolEnd ? `Account added ${ben!.addedAt}, usable from ${coolEnd}` : undefined);
    const spent = st.spentByDay.get(day) ?? 0;
    add("DAILY_LIMIT", spent + it.amount <= pol.dailyLimit, `${spent} spent of ${pol.dailyLimit}`);
    add("VELOCITY", st.vendorCountToday(it.vendorId, at) < pol.maxPaymentsPerVendorPerDay);
    add("RELEASE_WINDOW", inReleaseWindow(at, pol.releaseStartMin, pol.releaseEndMin));
    add("FUNDS", st.balance >= it.amount);
    return finish(checks, v, hash, at, { coolEnd, pol });
  } catch (err) {
    add("GUARD_ERROR", false, String(err).slice(0, 200));
    return finish(checks, base, hash, at);
  }
}

function finish(checks: Check[], v: Pick<GuardVerdict, "tier" | "needs" | "needReasons" | "agentOnly">, hash: string, at: ISO, x?: { coolEnd: ISO; pol: TreasuryState["policy"] }): GuardVerdict {
  const failed = checks.filter((c) => !c.ok);
  const hard = failed.filter((c) => !DEFERRABLE.has(c.code) && !RETRYABLE.has(c.code) && c.code !== "APPROVALS_COMPLETE");
  if (hard.length) return { ...v, outcome: "block", checks, code: hard[0].code, detail: hard[0].detail, final: true, hash };
  const retry = failed.find((c) => RETRYABLE.has(c.code));
  if (retry) return { ...v, outcome: "block", checks, code: retry.code, detail: retry.detail, final: false, hash };
  // Outside the release window nothing else is decided yet: caps and approvals are worked out when it opens.
  if (failed.some((c) => c.code === "RELEASE_WINDOW") && x) {
    return { ...v, outcome: "defer", checks, code: "RELEASE_WINDOW", detail: "Outside the release window", final: false, deferUntil: nextReleaseOpen(at, x.pol.releaseStartMin, x.pol.releaseEndMin), hash };
  }
  if (failed.some((c) => c.code === "APPROVALS_COMPLETE")) return { ...v, outcome: "needs_approval", checks, code: "APPROVALS_COMPLETE", detail: failed.find((c) => c.code === "APPROVALS_COMPLETE")!.detail, final: false, hash };
  const wait = failed.find((c) => DEFERRABLE.has(c.code));
  if (wait && x) {
    const nextDay = nextReleaseOpen(nextIstMidnight(at), x.pol.releaseStartMin, x.pol.releaseEndMin);
    const until = wait.code === "COOLING" ? nextReleaseOpen(x.coolEnd, x.pol.releaseStartMin, x.pol.releaseEndMin)
      : wait.code === "RELEASE_WINDOW" ? nextReleaseOpen(at, x.pol.releaseStartMin, x.pol.releaseEndMin) : nextDay;
    return { ...v, outcome: "defer", checks, code: wait.code, detail: wait.detail, final: false, deferUntil: until, hash };
  }
  return { ...v, outcome: "release", checks, final: false, hash };
}

/** The rule a released payout runs under, by who approved it. */
export const payoutRule = (t: Tier): B2BRuleId => (t === "agents" ? "PAYOUT_AGENTS_V1" : t === "checker" ? "PAYOUT_CHECKER_V1" : "PAYOUT_CFO_V1");

export const RULE_FOR_CODE: Record<string, B2BRuleId> = {
  NOT_FROZEN: "FREEZE_V1", COOLING: "COOLING_V1", FIRST_PAYMENT_CAP: "FIRST_PAYMENT_CAP_V1", DAILY_LIMIT: "DAILY_LIMIT_V1",
  RELEASE_WINDOW: "RELEASE_WINDOW_V1", APPROVALS_VALID: "SOD_V1", NO_OPEN_BANK_CHANGE: "BANK_CHANGE_VERIFY_V1", APPROVALS_COMPLETE: "PAYOUT_CHECKER_V1", VELOCITY: "STRUCTURING_V1",
};

/** Submit to the bank. Called only by the treasury after verifyReceipt said "release" on the same state. */
export function submitToBank(ctx: GuardContext, r: Receipt, at: ISO, attempt: number) {
  const it = r.intent;
  const ben = ctx.state.beneficiaries.get(it.beneficiaryId)!;
  const script = ctx.world.bankScripts[it.invoiceIds[0]];
  return bank.submit(ctx.state.bankBook, intentHash(it), it.amount, ben.accountHash, it.rail, at, script, attempt);
}

// src/b2b/commands.ts: what people can do, validated with Zod. Every human action that can lead to money moving
// needs a step-up PIN (three wrong tries lock the person out for 15 minutes) and is signed on the person's own
// device key. A refused command is written to the ledger too, so attempts are as visible as actions.
import { z } from "zod";
import { addMin, hoursBetween } from "./clock";
import { canonical, dhash } from "./crypto";
import { approve as signApproval, governSign } from "./keys";
import { diffPolicy, GOVERNANCE_THRESHOLD, isLoosening, policyHash, TIMELOCK_HOURS, type Policy } from "./policy";
import { verifySig, governMessage } from "./crypto";
import type { Treasury } from "./treasury";
import type { ISO } from "./types";

const pin = z.string().max(12);
const person = z.string().regex(/^p_[a-z]+$/);
const reason = z.string().trim().min(3).max(200);
const money = z.number().int().positive().safe();

export const PolicyChanges = z.strictObject({
  perTxnCap: money.optional(), dailyLimit: money.optional(), agentOnlyDailyCap: z.number().int().nonnegative().safe().optional(),
  checkerFrom: money.optional(), cfoFrom: money.optional(), firstPaymentCap: money.optional(),
  coolingHoursNew: z.number().int().min(0).max(720).optional(), coolingHoursChanged: z.number().int().min(0).max(720).optional(),
  maxPaymentsPerVendorPerDay: z.number().int().min(1).max(50).optional(),
});

export const B2BCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approve"), intentHash: z.string(), personId: person, role: z.enum(["checker", "cfo"]), pin, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("decline"), intentHash: z.string(), personId: person, reason, pin, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("approval_round"), checker: person, cfo: person, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("change_request"), vendorId: z.string(), accountNo: z.string().regex(/^\d{9,18}$/), ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), by: z.string(), autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("callback"), requestId: z.string(), personId: person, outcome: z.enum(["confirmed", "denied"]), autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("decide_change"), requestId: z.string(), personId: person, decision: z.enum(["approved", "rejected"]), pin, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("propose_policy"), personId: person, changes: PolicyChanges, pin, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("propose_unfreeze"), personId: person, pin, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("propose_reinstate"), personId: person, agentId: z.string(), pin, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("sign_proposal"), proposalId: z.string(), personId: person, pin, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("veto_proposal"), proposalId: z.string(), personId: person, pin, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("freeze"), personId: person, reason, pin, autoplayed: z.boolean().optional() }),
  z.object({ kind: z.literal("suspend_agent"), personId: person, agentId: z.string(), reason, pin, autoplayed: z.boolean().optional() }),
]);
export type B2BCommand = z.infer<typeof B2BCommand>;
export interface CommandResult { ok: boolean; reason?: string; data?: Record<string, unknown> }

/** The demo PIN rule, standing in for the person's device or identity provider: six digits, not all zero. */
const pinOk = (p: string) => /^\d{6}$/.test(p) && p !== "000000";
const SCRIPTED_PIN = "482913";

export function applyCommand(t: Treasury, at: ISO, raw: B2BCommand): CommandResult {
  const parsed = B2BCommand.safeParse(raw);
  if (!parsed.success) return refuse(t, at, (raw as { kind?: string })?.kind ?? "unknown", "", "INVALID_COMMAND");
  const c = parsed.data;
  const st = t.state, w = t.world;
  const who = (id: string) => w.people.find((p) => p.id === id && p.companyId === t.companyId);

  /** Step-up: checks the PIN and the lockout, records the outcome. Returns the refusal, or null when it passed. */
  const stepUp = (personId: string, p: string | undefined): CommandResult | null => {
    const f = st.pinFails.get(personId);
    if (f?.lockedUntil && at < f.lockedUntil) return refuse(t, at, c.kind, personId, "LOCKED_OUT");
    if (p === undefined || !pinOk(p)) {
      const count = (f?.lockedUntil && at >= f.lockedUntil ? 0 : f?.count ?? 0) + 1;
      t.emit({ at, type: "step_up_failed", actor: "person", payload: { personId, count, lockedUntil: count >= 3 ? addMin(at, 15) : null } });
      return refuse(t, at, c.kind, personId, count >= 3 ? "WRONG_PIN_LOCKED" : "WRONG_PIN");
    }
    t.emit({ at, type: "step_up", actor: "person", payload: { personId, for: c.kind } });
    return null;
  };

  switch (c.kind) {
    case "approve": {
      const p = who(c.personId);
      const it = st.intents.get(c.intentHash);
      if (!p) return refuse(t, at, c.kind, c.personId, "NOT_IN_COMPANY");
      if (!p.roles.includes(c.role)) return refuse(t, at, c.kind, c.personId, "WRONG_ROLE");
      if (!it || it.status !== "awaiting_approval") return refuse(t, at, c.kind, c.personId, "NOT_AWAITING_APPROVAL");
      if (!it.needs.includes(c.role)) return refuse(t, at, c.kind, c.personId, "ROLE_NOT_NEEDED");
      if (it.approvals.some((a) => a.personId === p.id || a.role === c.role)) return refuse(t, at, c.kind, c.personId, "ALREADY_SIGNED");
      if (it.intent.preparedFor === p.id) return refuse(t, at, c.kind, c.personId, "SOD_PREPARED_IT");
      const denied = stepUp(p.id, c.autoplayed ? SCRIPTED_PIN : c.pin);
      if (denied) return denied;
      const ap = signApproval(w.seed, t.companyId, p.id, c.role, c.intentHash, at);
      t.emit({ at, type: "approved", actor: "person", ruleId: c.role === "cfo" ? "PAYOUT_CFO_V1" : "PAYOUT_CHECKER_V1", payload: { intentHash: c.intentHash, approval: ap, name: p.name, autoplayed: !!c.autoplayed } });
      t.release(c.intentHash, at);
      return { ok: true, data: { status: st.intents.get(c.intentHash)!.status } };
    }
    case "decline": {
      const p = who(c.personId);
      const it = st.intents.get(c.intentHash);
      if (!p || !(p.roles.includes("checker") || p.roles.includes("cfo"))) return refuse(t, at, c.kind, c.personId, "WRONG_ROLE");
      if (!it || it.status !== "awaiting_approval") return refuse(t, at, c.kind, c.personId, "NOT_AWAITING_APPROVAL");
      const denied = stepUp(p.id, c.autoplayed ? SCRIPTED_PIN : c.pin);
      if (denied) return denied;
      t.emit({ at, type: "approval_declined", actor: "person", ruleId: "PAYOUT_CHECKER_V1", payload: { intentHash: c.intentHash, by: p.id, byName: p.name, reason: c.reason } });
      return { ok: true };
    }
    case "approval_round": {
      // The team's habit in the scripted story: the checker clears the queue, then the CFO signs what needs her.
      let n = 0;
      for (const role of ["checker", "cfo"] as const) {
        for (const it of [...st.intents.values()]) {
          if (it.status !== "awaiting_approval" || !it.needs.includes(role) || it.approvals.some((a) => a.role === role)) continue;
          if (role === "cfo" && !it.approvals.some((a) => a.role === "checker")) continue;
          const r = applyCommand(t, at, { kind: "approve", intentHash: it.hash, personId: role === "checker" ? c.checker : c.cfo, role, pin: SCRIPTED_PIN, autoplayed: true });
          if (r.ok) n++;
        }
      }
      return { ok: true, data: { approved: n } };
    }
    case "change_request": {
      const v = w.vendors.find((x) => x.id === c.vendorId && x.companyId === t.companyId);
      if (!v) return refuse(t, at, c.kind, c.by, "UNKNOWN_VENDOR");
      if ((st.newBeneficiariesByDay.get(t.dayKey(at)) ?? 0) >= st.policy.maxNewBeneficiariesPerDay) return refuse(t, at, c.kind, c.by, "TOO_MANY_NEW_ACCOUNTS_TODAY");
      const id = `cr_${v.id.slice(2)}_${st.changeRequests.size + 1}`;
      t.openChangeRequest(at, { id, vendorId: v.id, source: c.by === "vendor" ? "vendor_portal" : "vendor_portal", accountNo: c.accountNo, ifsc: c.ifsc, holderClaimed: null, openedBy: c.by });
      return { ok: true, data: { requestId: id } };
    }
    case "callback": {
      const p = who(c.personId);
      const cr = st.changeRequests.get(c.requestId);
      if (!p || !cr || cr.status !== "open") return refuse(t, at, c.kind, c.personId, "NOT_OPEN");
      const v = w.vendors.find((x) => x.id === cr.vendorId)!;
      t.emit({ at, type: "callback_logged", actor: "person", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { requestId: cr.id, by: p.id, byName: p.name, outcome: c.outcome, number: `Number on file, ${v.phoneOnFile}`, note: "Called the number in the vendor master, not any number in the request" } });
      if (c.outcome === "denied") {
        t.emit({ at, type: "change_request_decided", actor: "system", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { requestId: cr.id, decision: "rejected", by: "rule", reason: "Vendor says they did not ask for this change" } });
        const inv = cr.invoiceId ? w.invoices.find((i) => i.id === cr.invoiceId) : undefined;
        const amount = inv ? inv.total : 0;
        t.openCase(at, "fraud_attempt", v.id, cr.invoiceId, amount, `Someone asked to send ${v.brand}'s payments to an account held by ${cr.penny?.holder ?? "an unknown person"}. ${v.brand} confirmed on the number on file that they made no such request.`, cr.id);
        t.emit({ at, type: "stopped", actor: "system", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { requestId: cr.id, invoiceId: cr.invoiceId, amount, reason: "Bank change fraud stopped" } });
      }
      // Re-check payments that were waiting on this vendor's open request.
      for (const it of [...st.intents.values()]) if (it.intent.vendorId === v.id && (it.status === "awaiting_approval" || it.status === "blocked")) t.release(it.hash, at);
      return { ok: true };
    }
    case "decide_change": {
      const p = who(c.personId);
      const cr = st.changeRequests.get(c.requestId);
      if (!p || !p.roles.includes("checker")) return refuse(t, at, c.kind, c.personId, "WRONG_ROLE");
      if (!cr || cr.status !== "open") return refuse(t, at, c.kind, c.personId, "NOT_OPEN");
      if (cr.openedBy === p.id || cr.callback?.by === p.id) return refuse(t, at, c.kind, c.personId, "SOD_SAME_PERSON");
      if (c.decision === "approved") {
        if (cr.callback?.outcome !== "confirmed") return refuse(t, at, c.kind, c.personId, "CALLBACK_REQUIRED");
        if (!cr.penny?.found || cr.penny.score < 80) return refuse(t, at, c.kind, c.personId, "NAME_MISMATCH");
      }
      const denied = stepUp(p.id, c.autoplayed ? SCRIPTED_PIN : c.pin);
      if (denied) return denied;
      t.emit({ at, type: "change_request_decided", actor: "person", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { requestId: cr.id, decision: c.decision, by: p.id, reason: c.decision === "approved" ? "Penny drop name matches and the vendor confirmed on the number on file" : "Rejected by checker" } });
      if (c.decision === "approved") {
        const old = st.activeBeneficiary(cr.vendorId, at);
        const n = [...st.beneficiaries.values()].filter((b) => b.vendorId === cr.vendorId).length + 1;
        const beneficiary = { id: `b_${cr.vendorId.slice(2)}_${n}`, companyId: t.companyId, vendorId: cr.vendorId, accountNo: cr.accountNo, ifsc: cr.ifsc, nameAtBank: cr.penny!.holder!, accountHash: cr.accountHash, addedAt: at, addedVia: "change_request" as const, approvedBy: p.id };
        t.emit({ at, type: "beneficiary_added", actor: "person", ruleId: "COOLING_V1", payload: { beneficiary, replaces: old?.id ?? null, usableFrom: addMin(at, st.policy.coolingHoursChanged * 60) } });
        if (old) t.emit({ at, type: "beneficiary_retired", actor: "system", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { beneficiaryId: old.id, why: "Replaced by a verified new account" } });
      }
      t.retryWaiting(at);
      return { ok: true };
    }
    case "propose_policy": case "propose_unfreeze": case "propose_reinstate": {
      const p = who(c.personId);
      if (!p || !p.roles.includes("governor")) return refuse(t, at, c.kind, c.personId, "NOT_A_GOVERNOR");
      if (c.kind === "propose_unfreeze" && !st.frozen.on) return refuse(t, at, c.kind, c.personId, "NOT_FROZEN");
      if (c.kind === "propose_reinstate" && st.agentStatus.get(c.agentId) !== "suspended") return refuse(t, at, c.kind, c.personId, "NOT_SUSPENDED");
      const denied = stepUp(p.id, c.autoplayed ? SCRIPTED_PIN : c.pin);
      if (denied) return denied;
      const policy: Policy = c.kind === "propose_policy" ? { ...st.policy, ...c.changes, version: st.policy.version + 1 + [...st.proposals.values()].filter((x) => x.kind === "policy" && x.status !== "vetoed" && x.policy.version > st.policy.version).length } : st.policy;
      const diff = c.kind === "propose_policy" ? diffPolicy(st.policy, policy) : [];
      if (c.kind === "propose_policy" && !diff.length) return refuse(t, at, c.kind, c.personId, "NO_CHANGE");
      const id = `GOV-${100 + st.proposals.size + 1}`;
      const kind = c.kind === "propose_policy" ? "policy" : c.kind === "propose_unfreeze" ? "unfreeze" : "reinstate";
      const agentId = c.kind === "propose_reinstate" ? c.agentId : undefined;
      const hash = dhash("govern", canonical({ id, kind, companyId: t.companyId, policyHash: policyHash(policy), agentId: agentId ?? null }));
      const sig = governSign(w.seed, t.companyId, p.id, hash);
      t.emit({ at, type: "policy_proposed", actor: "person", ruleId: "GOVERNANCE_V1", payload: { proposal: { id, kind, agentId, policy, hash, diff, loosening: kind === "policy" ? isLoosening(diff) : true, by: p.id, at, sigs: { [p.id]: sig }, status: "proposed" } } });
      return { ok: true, data: { proposalId: id } };
    }
    case "sign_proposal": {
      const p = who(c.personId);
      const pr = st.proposals.get(c.proposalId);
      if (!p || !p.roles.includes("governor")) return refuse(t, at, c.kind, c.personId, "NOT_A_GOVERNOR");
      if (!pr || pr.status !== "proposed") return refuse(t, at, c.kind, c.personId, "NOT_OPEN");
      if (pr.sigs[p.id]) return refuse(t, at, c.kind, c.personId, "ALREADY_SIGNED");
      const denied = stepUp(p.id, c.autoplayed ? SCRIPTED_PIN : c.pin);
      if (denied) return denied;
      t.emit({ at, type: "policy_signed", actor: "person", ruleId: "GOVERNANCE_V1", payload: { proposalId: pr.id, by: p.id, sig: governSign(w.seed, t.companyId, p.id, pr.hash) } });
      // Count only signatures that verify, from distinct governors of this company.
      const valid = Object.entries(st.proposals.get(pr.id)!.sigs).filter(([pid, sig]) => {
        const g = who(pid);
        return g?.roles.includes("governor") && verifySig(g.publicKey, governMessage({ companyId: t.companyId, proposalHash: pr.hash, personId: pid }), sig);
      }).length;
      if (valid < GOVERNANCE_THRESHOLD) return { ok: true, data: { signatures: valid } };
      if (pr.kind === "policy" && pr.loosening) {
        t.emit({ at, type: "policy_scheduled", actor: "system", ruleId: "TIMELOCK_V1", payload: { proposalId: pr.id, effectiveAt: addMin(at, TIMELOCK_HOURS * 60) } });
      } else if (pr.kind === "policy") {
        t.emit({ at, type: "policy_activated", actor: "system", ruleId: "GOVERNANCE_V1", payload: { proposalId: pr.id, version: pr.policy.version, hash: pr.hash } });
        t.replanAll(at, `Policy v${pr.policy.version} is now active`);
      } else if (pr.kind === "unfreeze") {
        t.emit({ at, type: "proposal_executed", actor: "system", ruleId: "GOVERNANCE_V1", payload: { proposalId: pr.id } });
        t.emit({ at, type: "freeze", actor: "system", ruleId: "FREEZE_V1", payload: { on: false, by: "two governors", reason: "Released by two of three governors" } });
        t.retryWaiting(at);
      } else {
        t.emit({ at, type: "proposal_executed", actor: "system", ruleId: "GOVERNANCE_V1", payload: { proposalId: pr.id } });
        t.emit({ at, type: "agent_reinstated", actor: "system", ruleId: "KEY_SUSPEND_V1", payload: { agentId: pr.agentId } });
      }
      return { ok: true, data: { signatures: valid } };
    }
    case "veto_proposal": {
      const p = who(c.personId);
      const pr = st.proposals.get(c.proposalId);
      if (!p || !p.roles.includes("governor")) return refuse(t, at, c.kind, c.personId, "NOT_A_GOVERNOR");
      if (!pr || !(pr.status === "proposed" || pr.status === "scheduled")) return refuse(t, at, c.kind, c.personId, "NOT_OPEN");
      const denied = stepUp(p.id, c.autoplayed ? SCRIPTED_PIN : c.pin);
      if (denied) return denied;
      t.emit({ at, type: "policy_vetoed", actor: "person", ruleId: "TIMELOCK_V1", payload: { proposalId: pr.id, by: p.id, byName: p.name, hoursLeft: pr.effectiveAt ? Math.round(hoursBetween(at, pr.effectiveAt)) : null } });
      return { ok: true };
    }
    case "freeze": {
      // Tightening is instant and needs one person; releasing needs two governors.
      const p = who(c.personId);
      if (!p || !(p.roles.includes("governor") || p.roles.includes("cfo") || p.roles.includes("checker"))) return refuse(t, at, c.kind, c.personId, "WRONG_ROLE");
      if (st.frozen.on) return refuse(t, at, c.kind, c.personId, "ALREADY_FROZEN");
      const denied = stepUp(p.id, c.autoplayed ? SCRIPTED_PIN : c.pin);
      if (denied) return denied;
      t.emit({ at, type: "freeze", actor: "person", ruleId: "FREEZE_V1", payload: { on: true, by: p.name, reason: c.reason } });
      return { ok: true };
    }
    case "suspend_agent": {
      const p = who(c.personId);
      const a = w.agents.find((x) => x.id === c.agentId && x.companyId === t.companyId);
      if (!p || !p.roles.includes("governor")) return refuse(t, at, c.kind, c.personId, "NOT_A_GOVERNOR");
      if (!a || st.agentStatus.get(a.id) !== "active") return refuse(t, at, c.kind, c.personId, "NOT_ACTIVE");
      const denied = stepUp(p.id, c.autoplayed ? SCRIPTED_PIN : c.pin);
      if (denied) return denied;
      t.emit({ at, type: "agent_suspended", actor: "person", ruleId: "KEY_SUSPEND_V1", payload: { agentId: a.id, by: p.name, reason: c.reason } });
      return { ok: true };
    }
  }
}

function refuse(t: Treasury, at: ISO, kind: string, by: string, reason: string): CommandResult {
  t.emit({ at, type: "command_refused", actor: "person", payload: { kind, by, reason } });
  return { ok: false, reason };
}

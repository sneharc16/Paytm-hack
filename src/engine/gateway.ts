// src/engine/gateway.ts: the only path from a decision to a change in the world (PRD 13).
import { sha256 } from "@/lib/hash";
import * as bank from "@/sim/bank";
import * as merchantSim from "@/sim/merchant";
import * as npci from "@/sim/npci";
import { addMin, addSec, isPeak, isQuiet, istDay, ms, nextMorning, nextOffPeak } from "./clock";
import { writeNudge, type NudgeKind } from "./explain";
import type { Session } from "./session";
import type { Actor, ISO } from "./types";

export type Tool =
  | "sendNudge" | "recordDecision" | "requestMerchantSkip" | "requestUserOptOut" | "scheduleRetry" | "requestRefund"
  | "openCase" | "assignHuman" | "bookCallback" | "alertMerchant" | "executeCharge" | "openIncident";

/** Tools whose execution can move money or stop money moving. */
export const MONEY_TOOLS = new Set<Tool>(["requestMerchantSkip", "requestUserOptOut", "requestRefund", "executeCharge"]);

export interface PlannedAction {
  type: Tool;
  ruleId: string;
  actor: Actor;
  targetId: string;
  cycleId?: string;
  discriminator?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: Record<string, any>;
}

export type GatewayStatus = "executed" | "duplicate" | "blocked" | "failed" | "rerouted";
export interface GatewayResult { status: GatewayStatus; key: string; actionId: string; reason?: string }

const RETRYABLE = new Set(["KILL_SWITCH_V1", "PIN_REQUIRED"]);

export function idempotencyKey(sessionId: string, a: PlannedAction) {
  return sha256([sessionId, a.type, a.targetId, a.cycleId ?? "", a.ruleId, a.discriminator ?? ""].join("|"));
}

/** Pakka-initiated actions stop at the kill switch. The customer's own opt-out and the merchant's scheduled charge do not. */
const isPakkaInitiated = (a: PlannedAction) => (a.actor === "ai" || a.actor === "rule") && a.type !== "executeCharge";

export function run(s: Session, at: ISO, a: PlannedAction): GatewayResult {
  if (!a.ruleId) throw new Error(`gateway: ${a.type} has no ruleId`);
  const key = idempotencyKey(s.id, a);
  const st = s.state;
  const prev = st.actions.get(key);
  // 2. Deduplicate. A failure, a kill-switch block or a missing PIN may run again with the same key.
  if (prev && !(prev.status === "failed" || (prev.status === "blocked" && RETRYABLE.has(prev.reason ?? "")))) {
    return { status: "duplicate", key, actionId: prev.actionId, reason: prev.reason };
  }
  const actionId = prev?.actionId ?? s.world.fixtures.actionIds[`${a.cycleId}|${a.discriminator}`] ?? `A-${6000 + st.actionCount + 1}`;
  const p = a.params ?? {};
  const cycle = a.cycleId ? s.idx.cycle.get(a.cycleId) : undefined;
  const mandateId: string | undefined = cycle?.mandateId ?? p.mandateId;
  const mandate = mandateId ? s.idx.mandate.get(mandateId) : undefined;
  const merchantId: string | undefined = mandate?.merchantId ?? p.merchantId;
  const subject = a.cycleId ? { subjectType: "cycle" as const, subjectId: a.cycleId } : mandateId ? { subjectType: "mandate" as const, subjectId: mandateId } : {};
  const base = { actor: a.actor, ruleId: a.ruleId, ...subject };

  s.emit({
    ...base, simAt: at, type: "action_planned", idempotencyKey: prev ? undefined : key,
    payload: { key, actionId, actionType: a.type, targetId: a.targetId, cycleId: a.cycleId, replay: a, ...pick(p, ["choice", "kind", "path", "attempt", "reason"]) },
  });
  const block = (reason: string, extra: Record<string, unknown> = {}): GatewayResult => {
    s.emit({ ...base, simAt: at, type: "action_blocked", payload: { key, actionId, actionType: a.type, reason, ...extra } });
    return { status: "blocked", key, actionId, reason };
  };

  // 3. Re-check on fresh state.
  if (isPakkaInitiated(a) && (st.killSwitch.global || (merchantId && st.killSwitch.merchants.has(merchantId)))) return block("KILL_SWITCH_V1");
  const cs = a.cycleId ? st.cycle(a.cycleId) : undefined;
  const mandateActive = !mandateId || st.mandateStatus.get(mandateId) === "active";
  if (!mandateActive && ["requestMerchantSkip", "requestUserOptOut", "executeCharge", "scheduleRetry", "sendNudge"].includes(a.type)) return block("MANDATE_INACTIVE");
  if (mandate?.irrevocable && (a.type === "requestMerchantSkip" || a.type === "requestUserOptOut" || (a.type === "recordDecision" && p.choice !== "keep"))) return block("IRREVOCABLE");
  if (a.type === "requestUserOptOut" && (!p.pinToken || !st.pinTokens.has(p.pinToken))) return block("PIN_REQUIRED");
  if (a.type === "executeCharge" && isPeak(new Date(at))) {
    st.addTimer(nextOffPeak(new Date(at)).toISOString(), "retry", a.cycleId!);
    return block("PEAK_WINDOW", { replannedTo: nextOffPeak(new Date(at)).toISOString() });
  }
  if ((a.type === "executeCharge" && p.attempt > 4) || (a.type === "scheduleRetry" && (cs?.attempts ?? 0) >= 4)) return block("RETRY_LIMIT");
  if (a.type === "requestMerchantSkip" && cs && (cs.noticeWithdrawn || cs.status === "skipped")) return block("STALE_NOTICE");
  if (a.type === "sendNudge" && cs && p.kind !== "stale" && p.kind !== "refund_offer" && (cs.status === "skipped" || cs.status === "opted_out")) return block("STALE_NOTICE_V1");
  if (a.type === "requestRefund" && p.path === "auto") {
    const settings = s.settings(merchantId!);
    const dayKey = `${merchantId}|${istDay(at)}`;
    const reason = p.amount > settings.refundCap ? "REFUND_CAP" : (st.refundReserved.get(dayKey) ?? 0) + p.amount > settings.refundDailyLimit ? "DAILY_LIMIT" : null;
    if (reason) {
      block(reason);
      const r = run(s, at, { ...a, ruleId: "REFUND_MERCHANT_V1", discriminator: "merchant_queue", params: { ...p, path: "merchant_queue" } });
      return { ...r, status: r.status === "executed" ? "rerouted" : r.status };
    }
  }

  // Pushes: quiet hours move the push, the nag cap drops it.
  let pushAt: ISO | null = null;
  if (a.type === "sendNudge") {
    if (cs && p.kind !== "stale" && p.kind !== "refund_offer" && cs.nudges >= 2) return block("NAG_CAP_V1");
    pushAt = at;
    if (isQuiet(new Date(at))) {
      const morning = nextMorning(new Date(at)).toISOString();
      pushAt = !cycle || ms(morning) < ms(addMin(cycle.dueAt, -60)) ? morning : null;
    }
    if (pushAt && (st.pushesPerUserDay.get(`${p.userId}|${istDay(pushAt)}`) ?? 0) >= 3) pushAt = null; // NAG_CAP_V1: in-app card only
  }

  // 5 to 8. Execute through the simulator, verify, explain, record.
  const exec = (payload: Record<string, unknown> = {}, when = at) =>
    s.emit({ ...base, simAt: when, type: "action_executed", payload: { key, actionId, actionType: a.type, money: MONEY_TOOLS.has(a.type), ...payload } });
  const verified = (when: ISO, payload: Record<string, unknown> = {}) =>
    s.emit({ ...base, simAt: when, type: "action_verified", payload: { key, actionId, actionType: a.type, ...payload } });
  const inform = (when: ISO, userId: string, kind: string, extra: Record<string, unknown> = {}) =>
    s.emit({ actor: "ai", simAt: when, type: "customer_informed", ruleId: a.ruleId, ...subject, payload: { userId, kind, actionId, ...extra } });
  const userId = mandate?.userId ?? p.userId;

  switch (a.type) {
    case "sendNudge": {
      const w = a.cycleId ? writeNudge(s, a.cycleId, p.kind as NudgeKind, at) : p.written;
      s.emit({
        actor: "ai", simAt: addSec(at, 1), type: "nudge_sent", ruleId: a.ruleId, modelVersion: w.modelVersion, ...subject,
        payload: { userId, cycleId: a.cycleId, kind: p.kind, title: w.title, body: w.body, voice: w.voice, language: w.language, pushAt, askRule: p.askRule, fallback: w.fallback },
      });
      if (p.kind === "refund_offer") {
        s.emit({ actor: "rule", simAt: addSec(at, 1), type: "refund_offered", ruleId: a.ruleId, ...subject, payload: { executionId: p.executionId, cycleId: a.cycleId, mandateId, userId, merchantId, amount: p.amount } });
      }
      exec({ kind: p.kind }, addSec(at, 1));
      verified(addSec(at, 1));
      return { status: "executed", key, actionId };
    }
    case "recordDecision": {
      s.emit({ actor: "customer", simAt: at, type: "decision_recorded", ...subject, payload: { cycleId: a.cycleId, mandateId, choice: p.choice, late: !!p.late, autoplayed: !!p.autoplayed } });
      exec({ cycleId: a.cycleId, choice: p.choice, late: !!p.late, money: false });
      verified(at);
      if (p.late) inform(addSec(at, 1), userId, "result.late");
      else if (p.choice === "keep") inform(addSec(at, 1), userId, "result.keep");
      return { status: "executed", key, actionId };
    }
    case "requestMerchantSkip": {
      let r = merchantSim.skipCycle(st, cycle!, at, p.reason === "customer");
      if ("error" in r && r.error === "TIMEOUT") r = merchantSim.skipCycle(st, cycle!, addSec(at, 2), p.reason === "customer"); // one retry, same key
      if ("error" in r) {
        s.emit({ ...base, simAt: addSec(at, 2), type: "action_failed", payload: { key, actionId, actionType: a.type, reason: r.error } });
        inform(addSec(at, 2), userId, r.error === "TIMEOUT" ? "result.retrying" : "result.late");
        return { status: "failed", key, actionId, reason: r.error };
      }
      exec({ reason: p.reason }, addSec(at, 1));
      s.emit({ actor: "merchant", simAt: addSec(at, 3), type: "notice_withdrawn", ruleId: a.ruleId, ...subject, payload: { cycleId: a.cycleId, reason: p.reason, actionId } });
      verified(addSec(at, 3), { check: "notice_withdrawn" });
      inform(addSec(at, 3), userId, "result.skip", { reason: p.reason });
      return { status: "executed", key, actionId };
    }
    case "requestUserOptOut": {
      const r = bank.optOut(st, mandateId!, p.pinToken);
      if ("error" in r) return block(r.error);
      exec({ mandateId, kind: p.kind, pinToken: p.pinToken });
      verified(addSec(at, 1), { check: "mandate_" + p.kind });
      inform(addSec(at, 1), userId, p.kind === "pause" ? "result.pause" : "result.cancel");
      return { status: "executed", key, actionId };
    }
    case "scheduleRetry": {
      let executeAt: ISO = p.executeAt;
      if (isPeak(new Date(executeAt))) executeAt = nextOffPeak(new Date(executeAt)).toISOString();
      s.emit({ ...base, simAt: at, type: "retry_scheduled", payload: { cycleId: a.cycleId, attempt: p.attempt, executeAt, actionId } });
      exec({ executeAt, money: false });
      verified(at);
      inform(addSec(at, 1), userId, "retry.done", { executeAt });
      return { status: "executed", key, actionId };
    }
    case "requestRefund": {
      if (p.path === "auto") {
        s.emit({ ...base, simAt: at, type: "refund_requested", payload: { executionId: p.executionId, path: "auto", amount: p.amount } });
        s.emit({ ...base, simAt: at, type: "refund_reserved", payload: { executionId: p.executionId, merchantId, day: istDay(at), amount: p.amount } });
        exec({ executionId: p.executionId, amount: p.amount });
        s.emit({ ...base, simAt: addSec(at, 1), type: "refund_sent", payload: { executionId: p.executionId, amount: p.amount, path: "auto", key, to: "original_upi_account" } });
        return { status: "executed", key, actionId };
      }
      if (p.path === "merchant_queue") {
        const { queuedUntil } = merchantSim.queueRefund(at);
        const code = p.caseCode ?? nextCaseCode(s, mandateId!);
        s.emit({ ...base, simAt: at, type: "refund_requested", payload: { executionId: p.executionId, path: "merchant_queue", amount: p.amount, queuedUntil, caseCode: code } });
        s.emit({ actor: "rule", simAt: at, type: "case_opened", ruleId: a.ruleId, subjectType: "case", subjectId: code, payload: { code, caseType: "refund", status: "with_merchant", mandateId, userId, merchantId, executionId: p.executionId, amount: p.amount, customerAsk: "Refund of the first charge. App not opened.", fixture: !!s.world.fixtures.caseCodes[mandateId!] } });
        exec({ executionId: p.executionId, money: false, queuedUntil });
        verified(at);
        return { status: "executed", key, actionId };
      }
      // Merchant-approved or person-decided refund: the merchant sends it.
      exec({ executionId: p.executionId, amount: p.amount });
      s.emit({ actor: "merchant", simAt: addSec(at, 1), type: "refund_sent", ruleId: a.ruleId, ...subject, payload: { executionId: p.executionId, amount: p.amount, path: p.path, key, to: "original_upi_account" } });
      return { status: "executed", key, actionId };
    }
    case "openCase": {
      const code = p.code ?? nextCaseCode(s, mandateId!);
      s.emit({ actor: a.actor, ruleId: a.ruleId, simAt: at, type: "case_opened", subjectType: "case", subjectId: code, payload: { code, caseType: p.caseType, mandateId, userId, merchantId, amount: p.amount, executionId: p.executionId, customerAsk: p.customerAsk, fixture: !!s.world.fixtures.caseCodes[mandateId!] } });
      exec({ code, money: false });
      return { status: "executed", key, actionId };
    }
    case "assignHuman": {
      s.emit({ actor: "rule", ruleId: a.ruleId, simAt: at, type: "case_assigned", subjectType: "case", subjectId: a.targetId, payload: { code: a.targetId, to: "Priya Nair" } });
      s.emit({ actor: "ai", ruleId: a.ruleId, simAt: addSec(at, 2), type: "case_summary_written", modelVersion: p.summary.modelVersion, subjectType: "case", subjectId: a.targetId, payload: { code: a.targetId, summary: p.summary } });
      exec({ money: false });
      return { status: "executed", key, actionId };
    }
    case "bookCallback": {
      s.emit({ actor: "rule", ruleId: a.ruleId, simAt: at, type: "callback_booked", subjectType: "case", subjectId: a.targetId, payload: { code: a.targetId, by: p.by, callbackCode: p.callbackCode, from: "1600" } });
      exec({ money: false });
      return { status: "executed", key, actionId };
    }
    case "alertMerchant": {
      s.emit({ actor: "ai", ruleId: a.ruleId, simAt: at, type: "merchant_alerted", modelVersion: p.modelVersion, subjectType: "merchant", subjectId: merchantId, payload: { merchantId, incidentId: p.incidentId, headline: p.headline, detail: p.detail } });
      exec({ money: false });
      return { status: "executed", key, actionId };
    }
    case "openIncident": {
      s.emit({ actor: "ai", ruleId: a.ruleId, simAt: at, type: "incident_opened", subjectType: "incident", subjectId: p.incidentId, payload: { incidentId: p.incidentId, merchantId, metrics: p.metrics } });
      exec({ money: false });
      return { status: "executed", key, actionId };
    }
    case "executeCharge": {
      const scripted = s.idx.scripted.get(a.cycleId!)?.executionResults?.[p.attempt - 1];
      const { result } = npci.execute(p.attempt, at, scripted);
      const executionId = `ex_${a.cycleId}_${p.attempt}`;
      s.emit({ actor: "system", ruleId: a.ruleId, simAt: at, type: "execution_attempted", ...subject, payload: { cycleId: a.cycleId, attempt: p.attempt, executionId } });
      const ok = result === "success";
      s.emit({ actor: "system", ruleId: a.ruleId, simAt: addSec(at, 4), type: ok ? "execution_succeeded" : "execution_failed", ...subject, payload: { cycleId: a.cycleId, attempt: p.attempt, executionId, result, amount: cycle!.amount } });
      exec({ executionId, result, money: ok }, addSec(at, 4));
      return { status: "executed", key, actionId };
    }
  }
}

function pick(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}

const RESERVED = new Set(["PAK-2302", "PAK-2309", "PAK-2311", "PAK-2314"]);
export function nextCaseCode(s: Session, mandateId: string): string {
  const fixed = s.world.fixtures.caseCodes[mandateId];
  if (fixed) return fixed;
  let n = s.state.caseSeq;
  while (RESERVED.has(`PAK-${n}`) || s.state.cases.has(`PAK-${n}`)) n++;
  return `PAK-${n}`;
}

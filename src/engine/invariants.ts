// src/engine/invariants.ts: numbers that must always hold (PRD 13.5).
import { isPeak, istDay } from "./clock";
import { metrics } from "./metrics";
import type { Session } from "./session";

export function checkInvariants(s: Session): string[] {
  const fail: string[] = [];
  const st = s.state;
  const optOutTokens = new Set<string>();
  const autoPerDay = new Map<string, number>();
  const nudgesPerCycle = new Map<string, number>();
  for (const e of s.events) {
    const money = (e.type === "action_executed" && e.payload.money) || e.type === "execution_succeeded" || e.type === "refund_sent";
    if (money && !e.ruleId) fail.push(`1: money moved without a rule (event ${e.id})`);
    if (e.type === "execution_attempted" && isPeak(new Date(e.simAt))) fail.push(`2: execution in a peak window (event ${e.id})`);
    if (e.type === "execution_attempted" && e.payload.attempt > 4) fail.push(`3: more than 4 attempts (event ${e.id})`);
    if (e.type === "refund_sent" && e.ruleId === "REFUND_AUTO_V1") {
      const m = s.idx.mandate.get(st.refunds.get(e.payload.executionId)!.mandateId)!;
      const k = `${m.merchantId}|${istDay(e.simAt)}`;
      autoPerDay.set(k, (autoPerDay.get(k) ?? 0) + e.payload.amount);
    }
    if (e.type === "pin_verified") optOutTokens.add(e.payload.pinToken);
    if (e.type === "action_executed" && e.payload.actionType === "requestUserOptOut" && !optOutTokens.has(e.payload.pinToken)) fail.push(`5: opt-out without a PIN token (event ${e.id})`);
    if (e.type === "action_executed" && e.subjectType && e.payload.actionType !== "sendNudge" && e.payload.actionType !== "executeCharge" && e.payload.actionType !== "recordDecision") {
      const cycle = e.subjectType === "cycle" ? s.idx.cycle.get(e.subjectId!) : undefined;
      const mandate = cycle ? s.idx.mandate.get(cycle.mandateId) : e.subjectType === "mandate" ? s.idx.mandate.get(e.subjectId!) : undefined;
      if (mandate?.irrevocable) fail.push(`6: action on an irrevocable mandate (event ${e.id})`);
    }
    if (e.type === "nudge_sent" && e.payload.cycleId && e.payload.kind !== "stale" && e.payload.kind !== "refund_offer") {
      nudgesPerCycle.set(e.payload.cycleId, (nudgesPerCycle.get(e.payload.cycleId) ?? 0) + 1);
    }
  }
  for (const [k, v] of autoPerDay) if (v > s.settings(k.split("|")[0]).refundDailyLimit) fail.push(`4: auto refunds over the daily limit for ${k}`);
  for (const [c, n] of nudgesPerCycle) if (n > 2) fail.push(`7: ${n} nudges for cycle ${c}`);
  for (const [k, n] of st.pushesPerUserDay) if (n > 3) fail.push(`7: ${n} pushes for ${k}`);
  const m = metrics(s);
  if (m.movedWithoutRule !== 0) fail.push("8: counter money moved without a rule is not 0");
  return fail;
}

// src/engine/agent.ts: one loop per tick (PRD 9.1 and 25.2). Time-driven rules plus the scripted actors
// of scenario.ts run in time order over (processedTo, to]. Every handler is guarded by state, and every
// state change goes through the gateway with an idempotency key, so a tick is safe to run twice.
import { hasNameGap } from "./namegap";
import { addMin, addSec, DEMO_END, ist, ms, SESSION_START } from "./clock";
import { run } from "./gateway";
import { scoreCycle } from "./risk";
import { issueNotice } from "@/sim/bank";
import { runRadar } from "./radar";
import * as scenario from "./scenario";
import type { Session } from "./session";
import type { Cycle, ISO, World } from "./types";

export interface Job { at: ISO; pri: number; kind: string; ref: string }

const scheduleCache = new WeakMap<World, Job[]>();

export function staticSchedule(w: World): Job[] {
  const hit = scheduleCache.get(w);
  if (hit) return hit;
  const jobs: Job[] = [];
  const startMs = ms(SESSION_START);
  const push = (at: ISO, pri: number, kind: string, ref: string) => { if (ms(at) > startMs) jobs.push({ at, pri, kind, ref }); };
  for (let t = ms(ist("2026-10-26 20:58")); t <= ms(DEMO_END) + 3 * 86_400_000; t += 3_600_000) push(new Date(t).toISOString(), 0, "radar", "");
  for (const d of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]) push(ist(`${d} 21:00`), 1, "refund_sweep", "");
  for (const c of w.cycles) {
    push(c.noticeAt, 3, "notice", c.id);
    push(addMin(c.dueAt, -180), 5, "follow_up", c.id);
    push(addMin(c.dueAt, -60), 5, "cutoff", c.id);
    push(c.dueAt, 6, "execute", c.id);
    push(addMin(c.dueAt, -48 * 60), 4, "remind", c.id);
  }
  scenario.scriptedJobs(w).forEach((j) => push(j.at, j.pri, j.kind, j.ref));
  jobs.sort((a, b) => ms(a.at) - ms(b.at) || a.pri - b.pri || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  scheduleCache.set(w, jobs);
  return jobs;
}

/** Advance the agent and the scripted actors to `to`. Returns the events emitted. */
export function tick(s: Session, to: ISO) {
  const jobs = staticSchedule(s.world);
  if (ms(to) <= ms(s.processedTo)) return s.drain();
  let lo = 0, hi = jobs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ms(jobs[mid].at) <= ms(s.processedTo)) lo = mid + 1; else hi = mid; }
  let i = lo;
  for (;;) {
    const nextStatic = i < jobs.length && ms(jobs[i].at) <= ms(to) ? jobs[i] : undefined;
    const timer = s.state.timers.find((t) => ms(t.at) <= ms(to));
    if (!nextStatic && !timer) break;
    let job: Job;
    if (timer && (!nextStatic || ms(timer.at) < ms(nextStatic.at))) {
      s.state.timers = s.state.timers.filter((t) => t !== timer);
      job = { at: timer.at, pri: 0, kind: `timer:${timer.kind}`, ref: timer.ref };
    } else {
      job = nextStatic!;
      i++;
    }
    handle(s, job);
  }
  s.processedTo = to;
  return s.drain();
}

function handle(s: Session, j: Job) {
  switch (j.kind) {
    case "radar": return runRadar(s, j.at);
    case "refund_sweep": return refundSweep(s, j.at);
    case "notice": return onNotice(s, s.idx.cycle.get(j.ref)!, j.at);
    case "follow_up": return onFollowUp(s, s.idx.cycle.get(j.ref)!, j.at);
    case "cutoff": return onCutoff(s, s.idx.cycle.get(j.ref)!, j.at);
    case "execute": return onExecute(s, s.idx.cycle.get(j.ref)!, j.at);
    case "remind": return onRemind(s, s.idx.cycle.get(j.ref)!, j.at);
    case "timer:retry": return onRetryTimer(s, j.ref, j.at);
    case "timer:refund_confirm": return onRefundConfirm(s, j.ref, j.at);
    default: return scenario.handle(s, j);
  }
}

function onNotice(s: Session, c: Cycle, at: ISO) {
  const cs = s.state.cycle(c.id);
  if (cs.status !== "scheduled") return;
  const m = s.idx.mandate.get(c.mandateId)!;
  if (s.state.mandateStatus.get(m.id) !== "active") return;
  const mer = s.idx.merchant.get(m.merchantId)!;
  const t = addSec(at, 2);
  s.emit({ actor: "rule", simAt: t, type: "notice_received", subjectType: "cycle", subjectId: c.id, payload: issueNotice(c, mer.legalName, m.umn) });
  if (m.irrevocable) {
    s.emit({ actor: "ai", simAt: t, type: "risk_scored", modelVersion: "mandate-risk-v1", subjectType: "cycle", subjectId: c.id, payload: { cycleId: c.id, score: null, band: "remind_only", contributions: [] } });
    return;
  }
  const plan = s.idx.plan.get(m.planId)!;
  const signal = s.idx.usage.get(m.id);
  // CONSENT_USAGE_V1: the usage signal counts only where consent is recorded.
  const usage = m.usageConsent && signal ? (signal.openedSinceTrial ? "opened" : "not_opened") : "unknown";
  const score = scoreCycle({
    cycleId: c.id, at: t, amount: c.amount, trialAmount: c.firstAfterTrial ? plan.trialAmount : null,
    firstCharge: c.firstAfterTrial || c.seq === 1, usage, nameGap: hasNameGap(mer.brand, mer.legalName),
    openIncident: !!s.state.openIncidentFor(mer.id), medianRecent: null, quickCancelHistory: false,
    irrevocable: false, knownObligation: mer.knownObligation, alwaysKeep: s.state.alwaysKeep.has(m.id),
    confirmed: !!c.confirmedInMerchantAppAt,
  });
  s.emit({ actor: "ai", simAt: t, type: "risk_scored", modelVersion: "mandate-risk-v1", subjectType: "cycle", subjectId: c.id, payload: { ...score } });

  const settings = s.settings(mer.id);
  const t3 = addSec(at, 3);
  const prev = (s.idx.historyByMandate.get(m.id) ?? []).at(-1);
  if (prev?.result === "insufficient_funds" && usage === "opened" && ms(c.dueAt) - ms(at) <= 27 * 3_600_000) {
    run(s, t3, { type: "sendNudge", ruleId: "COLLECT_ASSIST_V1", actor: "ai", targetId: m.userId, cycleId: c.id, discriminator: "collect", params: { userId: m.userId, kind: "collect" } });
    return;
  }
  // "Always keep" is the customer's standing yes, so Doosri Haan does not ask again.
  const dh = settings.askBeforeFirstCharge && c.firstAfterTrial && !c.confirmedInMerchantAppAt && !s.state.alwaysKeep.has(m.id);
  const rule = dh ? "DH_ASK_V1" : score.band === "ask" ? "PAKKA_ASK_V1" : score.band === "tell" ? "TELL_V1" : null;
  if (!rule) return;
  run(s, t3, { type: "sendNudge", ruleId: rule, actor: "ai", targetId: m.userId, cycleId: c.id, discriminator: rule === "TELL_V1" ? "tell" : "ask", params: { userId: m.userId, kind: rule === "TELL_V1" ? "tell" : "ask", askRule: rule } });
}

function onFollowUp(s: Session, c: Cycle, at: ISO) {
  const cs = s.state.cycle(c.id);
  if (cs.status !== "awaiting_answer" || cs.decision || cs.band !== "ask" || !cs.askRule || cs.askRule === "TELL_V1") return;
  const m = s.idx.mandate.get(c.mandateId)!;
  run(s, at, { type: "sendNudge", ruleId: "FOLLOW_UP_V1", actor: "ai", targetId: m.userId, cycleId: c.id, discriminator: "follow_up", params: { userId: m.userId, kind: "follow_up" } });
}

function onCutoff(s: Session, c: Cycle, at: ISO) {
  const cs = s.state.cycle(c.id);
  if (cs.status !== "awaiting_answer" || cs.decision || cs.askRule !== "DH_ASK_V1") return;
  if (!s.settings(s.idx.mandate.get(c.mandateId)!.merchantId).askBeforeFirstCharge) return;
  run(s, at, { type: "requestMerchantSkip", ruleId: "DH_ASK_V1", actor: "rule", targetId: c.id, cycleId: c.id, discriminator: "no_answer", params: { reason: "no_answer" } });
}

function chargeAttempt(s: Session, c: Cycle, attempt: number, at: ISO) {
  const r = run(s, at, { type: "executeCharge", ruleId: "MANDATE_SCHEDULE_V1", actor: "system", targetId: c.id, cycleId: c.id, discriminator: String(attempt), params: { attempt } });
  if (r.status !== "executed") return; // already done on an earlier pass
  const cs = s.state.cycle(c.id);
  const m = s.idx.mandate.get(c.mandateId)!;
  if (cs.status === "failed_business") {
    run(s, addSec(at, 5), { type: "sendNudge", ruleId: "FAILED_INFORM_V1", actor: "ai", targetId: m.userId, cycleId: c.id, discriminator: `failed|${attempt}`, params: { userId: m.userId, kind: "failed" } });
  } else if (cs.status === "exhausted") {
    // Four attempts used: Pakka stops and the merchant takes over (PRD J3).
    s.emit({ actor: "ai", simAt: addSec(at, 5), type: "customer_informed", ruleId: "RETRY_SCHEDULE_V1", subjectType: "cycle", subjectId: c.id, payload: { userId: m.userId, kind: "failed.limit" } });
  } else if (cs.status === "succeeded" && attempt > 1) {
    s.emit({ actor: "ai", simAt: addSec(at, 5), type: "customer_informed", ruleId: "MANDATE_SCHEDULE_V1", subjectType: "cycle", subjectId: c.id, payload: { userId: m.userId, kind: "success.title" } });
  }
}

function onExecute(s: Session, c: Cycle, at: ISO) {
  const cs = s.state.cycle(c.id);
  if (cs.attempts > 0) return;
  if (s.state.mandateStatus.get(c.mandateId) !== "active") return;
  const executable = cs.status === "confirmed" || cs.status === "ready" || cs.status === "notice_received"
    || (cs.status === "awaiting_answer" && cs.askRule !== "DH_ASK_V1"); // Doosri Haan off: silence means the charge goes ahead
  if (!executable) return;
  chargeAttempt(s, c, 1, at);
}

function onRetryTimer(s: Session, cycleId: string, at: ISO) {
  const cs = s.state.cycle(cycleId);
  if (cs.status !== "retry_scheduled" && !(cs.attempts === 0 && (cs.status === "ready" || cs.status === "confirmed"))) return;
  chargeAttempt(s, s.idx.cycle.get(cycleId)!, cs.attempts + 1, at);
}

export function merchantRetry(s: Session, cycleId: string, at: ISO) {
  const cs = s.state.cycle(cycleId);
  if (cs.status !== "failed_business" || cs.attempts >= 4) return;
  chargeAttempt(s, s.idx.cycle.get(cycleId)!, cs.attempts + 1, at);
}

function onRemind(s: Session, c: Cycle, at: ISO) {
  const m = s.idx.mandate.get(c.mandateId)!;
  if (!m.irrevocable || s.state.cycle(c.id).nudges > 0) return;
  run(s, at, { type: "sendNudge", ruleId: "REMIND_ONLY_V1", actor: "ai", targetId: m.userId, cycleId: c.id, discriminator: "remind", params: { userId: m.userId, kind: "remind" } });
}

function refundSweep(s: Session, at: ISO) {
  for (const h of s.world.history) {
    if (h.result !== "success" || s.state.refunds.has(h.id)) continue;
    const c = s.idx.cycle.get(h.cycleId);
    if (!c?.firstAfterTrial || ms(at) - ms(h.at) > 72 * 3_600_000) continue;
    const m = s.idx.mandate.get(h.mandateId)!;
    const signal = s.idx.usage.get(m.id);
    if (!m.usageConsent || !signal || signal.openedSinceTrial || !s.settings(m.merchantId).shareUsageSignal) continue;
    run(s, at, { type: "sendNudge", ruleId: "REFUND_OFFER_V1", actor: "ai", targetId: m.userId, cycleId: c.id, discriminator: "refund_offer", params: { userId: m.userId, kind: "refund_offer", executionId: h.id, amount: h.amount } });
  }
}

function onRefundConfirm(s: Session, executionId: string, at: ISO) {
  const r = s.state.refunds.get(executionId);
  if (!r || r.status !== "sent") return;
  s.emit({ actor: "system", simAt: at, type: "refund_confirmed", subjectType: "mandate", subjectId: r.mandateId, payload: { executionId, to: "original_upi_account" } });
  const key = [...s.state.actions.values()].find((a) => a.type === "requestRefund" && a.targetId === executionId && a.status === "executed")?.key;
  if (key) s.emit({ actor: "rule", simAt: at, type: "action_verified", payload: { key, actionType: "requestRefund", check: "credit_seen" } });
  s.emit({ actor: "ai", simAt: at, type: "customer_informed", subjectType: "mandate", subjectId: r.mandateId, payload: { userId: r.userId, kind: "refund.done", executionId } });
  if (r.caseCode) s.emit({ actor: "system", simAt: at, type: "case_closed", subjectType: "case", subjectId: r.caseCode, payload: { code: r.caseCode, outcome: "refunded" } });
}

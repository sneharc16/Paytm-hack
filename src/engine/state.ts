// src/engine/state.ts: applyEvent(state, event). State is always replay(world, events).
import { addMin, istDay } from "./clock";
import type { Band } from "./risk";
import type { Choice, ISO, MerchantSettings, PakkaEvent, Paise, World } from "./types";

export type CycleStatus =
  | "scheduled" | "notice_received" | "awaiting_answer" | "confirmed" | "ready"
  | "skipped" | "opted_out" | "succeeded" | "failed_business" | "failed_technical" | "retry_scheduled" | "exhausted";

export interface CycleState {
  status: CycleStatus;
  band?: Band;
  score?: number;
  askRule?: string; // DH_ASK_V1 or PAKKA_ASK_V1
  decision?: Choice;
  decisionAt?: ISO;
  lateDecision?: Choice;
  skipReason?: "customer" | "no_answer" | "stale";
  optOutKind?: "pause" | "cancel";
  attempts: number;
  nudges: number;
  retryAt?: ISO;
  lastResult?: string;
  topupAt?: ISO;
  noticeAt?: ISO;
  noticeWithdrawn: boolean;
  /** Set when the customer moved to a cheaper plan: the fresh notice's amount, time and plan. */
  amountOverride?: Paise;
  dueOverride?: ISO;
  planOverride?: string;
}

export interface RefundState {
  executionId: string; cycleId: string; mandateId: string; userId: string; merchantId: string; amount: Paise;
  status: "offered" | "declined_by_customer" | "requested" | "with_merchant" | "sent" | "confirmed" | "merchant_declined";
  path?: "auto" | "merchant_queue" | "person";
  offeredAt?: ISO; requestedAt?: ISO; sentAt?: ISO; confirmedAt?: ISO; queuedUntil?: ISO; caseCode?: string;
}

export interface CaseState {
  code: string; type: "refund" | "person" | "fraud"; mandateId: string; userId: string; merchantId: string;
  executionId?: string; amount: Paise;
  status: "open" | "with_merchant" | "with_person" | "refunded" | "upheld" | "closed";
  openedAt: ISO; assignedTo?: string; assignedAt?: ISO; summary?: Record<string, unknown>;
  callback?: { by: ISO; code: string; doneAt?: ISO }; decision?: { decision: string; reason: string; by: string; at: ISO };
  merchantPosition?: string; customerAsk?: string;
}

export interface ActionRecord {
  key: string; actionId: string; type: string; ruleId: string; status: "planned" | "executed" | "verified" | "blocked" | "failed";
  reason?: string; cycleId?: string; targetId: string; at: ISO; replay?: Record<string, unknown>;
}

export interface NudgeRecord {
  eventId: number; userId: string; cycleId?: string; kind: string; at: ISO; pushAt: ISO | null; title: string; body: string;
  language: string; modelVersion: string;
}

export interface Incident { id: string; merchantId: string; openedAt: ISO; metrics: Record<string, number> }

export class EngineState {
  cursor: ISO;
  cycles = new Map<string, CycleState>();
  mandateStatus = new Map<string, "active" | "paused" | "revoked">();
  alwaysKeep = new Set<string>();
  merchantSettings = new Map<string, MerchantSettings>();
  settingsChangedBy = new Map<string, { by: string; at: ISO }>();
  actions = new Map<string, ActionRecord>();
  actionCount = 0;
  queued: string[] = []; // action keys blocked by the kill switch, in order
  killSwitch = { global: false, merchants: new Set<string>() };
  pinTokens = new Set<string>();
  refunds = new Map<string, RefundState>();
  refundReserved = new Map<string, Paise>(); // `${merchantId}|${istDay}` -> paise reserved on the auto path
  cases = new Map<string, CaseState>();
  caseByMandate = new Map<string, string>();
  caseSeq = 2300;
  incidents = new Map<string, Incident>();
  taggedReviews = new Map<string, { gap: string; confidence: number; evidence: string }>();
  nudges: NudgeRecord[] = [];
  nudgesByUser = new Map<string, NudgeRecord[]>();
  pushesPerUserDay = new Map<string, number>();
  executions = new Map<string, { id: string; cycleId: string; attempt: number; at: ISO; result: string; amount: Paise; ruleId?: string }>();
  timers: { at: ISO; kind: string; ref: string }[] = [];
  questions: { userId: string; text: string; intent: string; mandateId?: string; at: ISO }[] = [];
  invariantFailures: string[] = [];

  constructor(public world: World, start: ISO) {
    this.cursor = start;
    for (const m of world.merchants) this.merchantSettings.set(m.id, structuredClone(m.settings));
    for (const c of world.cycles) this.cycles.set(c.id, { status: "scheduled", attempts: 0, nudges: 0, noticeWithdrawn: false });
    for (const m of world.mandates) this.mandateStatus.set(m.id, "active");
    for (const h of world.history) this.executions.set(h.id, { id: h.id, cycleId: h.cycleId, attempt: 1, at: h.at, result: h.result, amount: h.amount, ruleId: "MANDATE_SCHEDULE_V1" });
  }

  cycle(id: string): CycleState {
    const c = this.cycles.get(id);
    if (!c) throw new Error(`unknown cycle ${id}`);
    return c;
  }

  addTimer(at: ISO, kind: string, ref: string) {
    if (this.timers.some((t) => t.kind === kind && t.ref === ref)) return;
    this.timers.push({ at, kind, ref });
    this.timers.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }
  dropTimer(kind: string, ref: string) {
    this.timers = this.timers.filter((t) => !(t.kind === kind && t.ref === ref));
  }

  apply(e: PakkaEvent) {
    if (e.simAt > this.cursor) this.cursor = e.simAt;
    const p = e.payload;
    switch (e.type) {
      case "kill_switch_changed":
        if (p.scope === "global") this.killSwitch.global = p.on;
        else if (p.on) this.killSwitch.merchants.add(p.scope);
        else this.killSwitch.merchants.delete(p.scope);
        break;
      case "merchant_settings_changed":
        this.merchantSettings.set(p.merchantId, { ...this.merchantSettings.get(p.merchantId)!, ...p.settings });
        this.settingsChangedBy.set(p.merchantId, { by: p.by, at: e.simAt });
        break;
      case "notice_received": {
        const c = this.cycle(p.cycleId);
        if (c.status === "scheduled") c.status = "notice_received";
        c.noticeAt = e.simAt;
        break;
      }
      case "notice_withdrawn": {
        const c = this.cycle(p.cycleId);
        c.noticeWithdrawn = true;
        c.status = "skipped";
        c.skipReason = p.reason;
        break;
      }
      case "risk_scored": {
        const c = this.cycle(p.cycleId);
        c.band = p.band; c.score = p.score;
        if (c.status === "notice_received") c.status = p.band === "ask" || p.band === "tell" ? "awaiting_answer" : "ready";
        break;
      }
      case "nudge_sent": {
        const n: NudgeRecord = { eventId: e.id, userId: p.userId, cycleId: p.cycleId, kind: p.kind, at: e.simAt, pushAt: p.pushAt ?? null, title: p.title, body: p.body, language: p.language, modelVersion: e.modelVersion ?? "template" };
        this.nudges.push(n);
        const list = this.nudgesByUser.get(p.userId) ?? [];
        list.push(n);
        this.nudgesByUser.set(p.userId, list);
        if (p.cycleId && p.kind !== "stale" && p.kind !== "refund_offer") this.cycle(p.cycleId).nudges++;
        if (n.pushAt) {
          const k = `${p.userId}|${istDay(n.pushAt)}`;
          this.pushesPerUserDay.set(k, (this.pushesPerUserDay.get(k) ?? 0) + 1);
        }
        if (p.askRule && p.cycleId) {
          const c = this.cycle(p.cycleId);
          c.askRule = p.askRule;
          if (c.status === "ready" || c.status === "notice_received") c.status = "awaiting_answer";
        }
        break;
      }
      case "decision_recorded": {
        if (p.refund) { const r = this.refunds.get(p.executionId); if (r) r.status = "declined_by_customer"; break; }
        if (p.choice === "always_keep") { this.alwaysKeep.add(p.mandateId); break; }
        const c = this.cycle(p.cycleId);
        if (p.late) { c.lateDecision = p.choice; break; }
        c.decision = p.choice; c.decisionAt = e.simAt;
        break;
      }
      case "pin_verified":
        this.pinTokens.add(p.pinToken);
        break;
      case "topup_confirmed":
        this.cycle(p.cycleId).topupAt = e.simAt;
        break;
      case "action_planned": {
        const prev = this.actions.get(p.key);
        if (!prev) this.actionCount++;
        this.actions.set(p.key, {
          key: p.key, actionId: p.actionId, type: p.actionType, ruleId: e.ruleId ?? "", status: "planned",
          cycleId: p.cycleId, targetId: p.targetId, at: e.simAt, replay: p.replay,
        });
        this.queued = this.queued.filter((k) => k !== p.key);
        break;
      }
      case "action_blocked": {
        const a = this.actions.get(p.key);
        if (a) { a.status = "blocked"; a.reason = p.reason; }
        if (p.reason === "KILL_SWITCH_V1" && !this.queued.includes(p.key)) this.queued.push(p.key);
        break;
      }
      case "action_executed": {
        const a = this.actions.get(p.key);
        if (a) a.status = "executed";
        if (p.actionType === "requestUserOptOut") {
          this.mandateStatus.set(p.mandateId, p.kind === "pause" ? "paused" : "revoked");
          for (const c of this.world.cycles) {
            if (c.mandateId !== p.mandateId) continue;
            const cs = this.cycle(c.id);
            if (["scheduled", "notice_received", "awaiting_answer", "confirmed", "ready", "retry_scheduled", "failed_business"].includes(cs.status)) {
              cs.status = "opted_out"; cs.optOutKind = p.kind; this.dropTimer("retry", c.id);
            }
          }
        }
        if (p.actionType === "requestMerchantDowngrade") {
          const cs = this.cycle(p.cycleId);
          cs.status = "confirmed";
          cs.amountOverride = p.amount; cs.dueOverride = p.dueAt; cs.planOverride = p.planId;
          this.addTimer(p.dueAt, "charge", p.cycleId);
        }
        if (p.actionType === "recordDecision" && p.choice === "keep") {
          const cs = this.cycle(p.cycleId);
          if (cs.status === "awaiting_answer" || cs.status === "notice_received") cs.status = "confirmed";
        }
        break;
      }
      case "action_verified": {
        const a = this.actions.get(p.key);
        if (a) a.status = "verified";
        break;
      }
      case "action_failed": {
        const a = this.actions.get(p.key);
        if (a) { a.status = "failed"; a.reason = p.reason; }
        break;
      }
      case "execution_attempted": {
        const c = this.cycle(p.cycleId);
        c.attempts = p.attempt;
        this.dropTimer("retry", p.cycleId);
        break;
      }
      case "execution_succeeded":
      case "execution_failed": {
        const c = this.cycle(p.cycleId);
        const ok = e.type === "execution_succeeded";
        c.lastResult = p.result;
        c.status = ok ? "succeeded" : p.result === "insufficient_funds" ? (c.attempts >= 4 ? "exhausted" : "failed_business") : c.attempts >= 4 ? "exhausted" : "failed_technical";
        c.retryAt = undefined;
        this.executions.set(p.executionId, { id: p.executionId, cycleId: p.cycleId, attempt: p.attempt, at: e.simAt, result: p.result, amount: p.amount, ruleId: e.ruleId });
        break;
      }
      case "retry_scheduled": {
        const c = this.cycle(p.cycleId);
        c.status = "retry_scheduled"; c.retryAt = p.executeAt;
        this.addTimer(p.executeAt, "retry", p.cycleId);
        break;
      }
      case "refund_offered":
        this.refunds.set(p.executionId, { ...p, status: "offered", offeredAt: e.simAt } as RefundState);
        break;
      case "refund_requested": {
        const r = this.refunds.get(p.executionId)!;
        r.status = p.path === "auto" ? "requested" : "with_merchant";
        r.path = p.path; r.requestedAt = e.simAt; r.queuedUntil = p.queuedUntil;
        if (p.caseCode) r.caseCode = p.caseCode;
        break;
      }
      case "refund_reserved": {
        const k = `${p.merchantId}|${p.day}`;
        this.refundReserved.set(k, (this.refundReserved.get(k) ?? 0) + p.amount);
        break;
      }
      case "refund_sent": {
        const r = this.refunds.get(p.executionId)!;
        r.status = "sent"; r.sentAt = e.simAt; r.path = p.path;
        this.addTimer(addMin(e.simAt, 2), "refund_confirm", p.executionId);
        if (r.caseCode) { const cs = this.cases.get(r.caseCode); if (cs) cs.status = "refunded"; }
        break;
      }
      case "refund_confirmed": {
        const r = this.refunds.get(p.executionId)!;
        r.status = "confirmed"; r.confirmedAt = e.simAt;
        this.dropTimer("refund_confirm", p.executionId);
        break;
      }
      case "merchant_decision": {
        const r = this.refunds.get(p.executionId);
        if (r && p.decision === "decline") r.status = "merchant_declined";
        if (r?.caseCode) {
          const cs = this.cases.get(r.caseCode);
          if (cs) cs.merchantPosition = p.reason ?? (p.decision === "approve" ? "Approved the refund." : "");
        }
        break;
      }
      case "case_opened": {
        this.cases.set(p.code, { code: p.code, type: p.caseType, mandateId: p.mandateId, userId: p.userId, merchantId: p.merchantId, executionId: p.executionId, amount: p.amount, status: p.status ?? "open", openedAt: e.simAt, customerAsk: p.customerAsk });
        this.caseByMandate.set(p.mandateId, p.code);
        const n = Number(p.code.slice(4));
        if (!p.fixture && n >= this.caseSeq) this.caseSeq = n + 1;
        if (p.executionId) { const r = this.refunds.get(p.executionId); if (r) r.caseCode = p.code; }
        break;
      }
      case "case_assigned": {
        const cs = this.cases.get(p.code)!;
        cs.status = "with_person"; cs.assignedTo = p.to; cs.assignedAt = e.simAt;
        break;
      }
      case "case_summary_written":
        this.cases.get(p.code)!.summary = p.summary;
        break;
      case "callback_booked":
        this.cases.get(p.code)!.callback = { by: p.by, code: p.callbackCode };
        break;
      case "callback_done": {
        const cb = this.cases.get(p.code)!.callback;
        if (cb) cb.doneAt = e.simAt;
        break;
      }
      case "human_decision": {
        const cs = this.cases.get(p.code)!;
        cs.decision = { decision: p.decision, reason: p.reason, by: p.by, at: e.simAt };
        if (p.decision === "uphold") cs.status = "upheld";
        break;
      }
      case "case_closed":
        this.cases.get(p.code)!.status = "closed";
        break;
      case "incident_opened":
        this.incidents.set(p.incidentId, { id: p.incidentId, merchantId: p.merchantId, openedAt: e.simAt, metrics: p.metrics });
        break;
      case "review_tagged":
        this.taggedReviews.set(p.reviewId, { gap: p.gap, confidence: p.confidence, evidence: p.evidence });
        break;
      case "question_resolved":
        this.questions.push({ userId: p.userId, text: p.text, intent: p.intent, mandateId: p.mandateId, at: e.simAt });
        break;
      default:
        break;
    }
  }

  openIncidentFor(merchantId: string): Incident | undefined {
    for (const i of this.incidents.values()) if (i.merchantId === merchantId) return i;
    return undefined;
  }
}

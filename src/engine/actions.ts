// src/engine/actions.ts: everything a person does (customer, merchant, Priya). The UI, the API and the
// scenario's scripted actors all call these, so a scripted tap and a real tap take the same path.
import { lintOffer } from "@/copy/lint";
import { sha256 } from "@/lib/hash";
import { dayMonth, inr } from "@/lib/format";
import * as bank from "@/sim/bank";
import { addMin, addSec, ist, istDay, istMinutes, ms, nextOffPeak } from "./clock";
import { nextCaseCode, run } from "./gateway";
import { resolveMandate, type Intake } from "./resolve";
import type { Session } from "./session";
import { mask } from "@/lib/privacy/mask";
import type { Choice, ISO, MerchantSettings, ReviewStamp } from "./types";

const PERSON = "Priya Nair";

export function verifyPin(s: Session, at: ISO, userId: string, digits: string): { pinToken: string } | { error: "WRONG_PIN" } {
  const r = bank.verifyPin(userId, digits, `${s.id}|${s.events.length}`);
  if ("pinToken" in r) s.emit({ actor: "customer", simAt: at, type: "pin_verified", payload: { userId, pinToken: r.pinToken } });
  return r;
}

/** Pakka live: the person confirmed with their passkey (verified by the server) instead of a PIN pad. The
 *  token is what the gateway checks before a pause or cancel, exactly like a PIN token. */
export function passkeyVerified(s: Session, at: ISO, userId: string, pinToken: string) {
  s.emit({ actor: "customer", simAt: at, type: "pin_verified", payload: { userId, pinToken, method: "passkey" } });
  return { pinToken };
}

const DECISION_RULE: Record<Choice, string> = {
  keep: "KEEP_V1", skip: "SKIP_VIA_MERCHANT_V1", pause: "USER_OPT_OUT_V1", cancel: "USER_OPT_OUT_V1", downgrade: "DOWNGRADE_VIA_MERCHANT_V1",
};

export type DecisionOutcome = { status: string; actionId?: string; reason?: string };

export function customerDecision(s: Session, at: ISO, cycleId: string, choice: Choice, opts: { pinToken?: string; autoplayed?: boolean } = {}): DecisionOutcome {
  const c = s.idx.cycle.get(cycleId)!;
  const cs = s.state.cycle(cycleId);
  const mandate = s.idx.mandate.get(c.mandateId)!;
  const cutoff = addMin(c.dueAt, -60);
  // Same choice again (a double tap): the gateway returns the first action.
  if (cs.decision === choice && choice !== "pause" && choice !== "cancel") {
    const r = run(s, at, { type: "recordDecision", ruleId: DECISION_RULE[choice], actor: "customer", targetId: cycleId, cycleId, discriminator: choice, params: { choice } });
    const follow = choice === "skip" ? run(s, at, { type: "requestMerchantSkip", ruleId: "SKIP_VIA_MERCHANT_V1", actor: "rule", targetId: cycleId, cycleId, discriminator: "skip", params: { reason: "customer" } }) : r;
    return { status: follow.status === "executed" ? "executed" : "duplicate", actionId: follow.actionId };
  }
  const late = ms(at) > ms(cutoff) || !["notice_received", "awaiting_answer", "confirmed", "ready"].includes(cs.status);
  // Pause and cancel are the customer's instruction to their bank: they work after the cut-off too, for future cycles.
  if (late && choice !== "pause" && choice !== "cancel") {
    const r = run(s, at, { type: "recordDecision", ruleId: DECISION_RULE[choice], actor: "customer", targetId: cycleId, cycleId, discriminator: `${choice}|late`, params: { choice, late: true, autoplayed: opts.autoplayed } });
    return { status: "late", actionId: r.actionId };
  }
  if (choice !== "keep" && mandate.irrevocable) return { status: "blocked", reason: "IRREVOCABLE" };
  const rec = run(s, at, { type: "recordDecision", ruleId: DECISION_RULE[choice], actor: "customer", targetId: cycleId, cycleId, discriminator: choice, params: { choice, autoplayed: opts.autoplayed } });
  if (rec.status === "duplicate" && choice !== "pause" && choice !== "cancel") return { status: "duplicate", actionId: rec.actionId };
  const t1 = addSec(at, 1);
  if (choice === "skip") {
    const r = run(s, t1, { type: "requestMerchantSkip", ruleId: "SKIP_VIA_MERCHANT_V1", actor: "rule", targetId: cycleId, cycleId, discriminator: "skip", params: { reason: "customer" } });
    return { status: r.status, actionId: r.actionId, reason: r.reason };
  }
  if (choice === "downgrade") {
    const planId = s.settings(mandate.merchantId).offerDowngradePlanId;
    if (!planId) return { status: "blocked", reason: "NOT_OFFERED", actionId: rec.actionId };
    const r = run(s, t1, { type: "requestMerchantDowngrade", ruleId: "DOWNGRADE_VIA_MERCHANT_V1", actor: "rule", targetId: cycleId, cycleId, discriminator: "downgrade", params: { planId } });
    return { status: r.status, actionId: r.actionId, reason: r.reason };
  }
  if (choice === "pause" || choice === "cancel") {
    const r = run(s, t1, { type: "requestUserOptOut", ruleId: "USER_OPT_OUT_V1", actor: "customer", targetId: mandate.id, cycleId, discriminator: choice, params: { kind: choice, pinToken: opts.pinToken, mandateId: mandate.id } });
    return { status: r.status, actionId: r.actionId, reason: r.reason };
  }
  return { status: rec.status, actionId: rec.actionId };
}

/** Next slot for a retry: the next off-peak minute, inside the nightly retry batch that opens at 9:30 PM IST. */
export function retrySlot(s: Session, cycleId: string, at: ISO): { slotStart: ISO; executeAt: ISO } {
  const t = nextOffPeak(new Date(at));
  const m = istMinutes(t);
  const startMs = m < 1290 ? t.getTime() - (t.getTime() % 60_000) + (1290 - m) * 60_000 : t.getTime();
  const slotStart = new Date(startMs).toISOString();
  const offset = s.world.fixtures.retryOffsetMin[cycleId] ?? parseInt(sha256(cycleId).slice(0, 4), 16) % 50;
  return { slotStart, executeAt: addMin(slotStart, offset) };
}

export function topupConfirmed(s: Session, at: ISO, cycleId: string, opts: { autoplayed?: boolean } = {}): DecisionOutcome {
  const cs = s.state.cycle(cycleId);
  // After the fourth attempt the cycle is exhausted; the tap still goes to the gateway so the block is recorded.
  if (cs.status !== "failed_business" && cs.status !== "exhausted") return { status: "ignored", reason: cs.status };
  const mandate = s.mandateOf(cycleId);
  s.emit({ actor: "customer", simAt: at, type: "topup_confirmed", subjectType: "cycle", subjectId: cycleId, payload: { cycleId, userId: mandate.userId, autoplayed: !!opts.autoplayed } });
  const { slotStart, executeAt } = retrySlot(s, cycleId, at);
  const r = run(s, addSec(at, 1), { type: "scheduleRetry", ruleId: "RETRY_SCHEDULE_V1", actor: "rule", targetId: cycleId, cycleId, discriminator: String(cs.attempts + 1), params: { attempt: cs.attempts + 1, executeAt, slotStart } });
  if (r.status === "blocked" && r.reason === "RETRY_LIMIT") {
    s.emit({ actor: "ai", simAt: addSec(at, 1), type: "customer_informed", ruleId: "RETRY_SCHEDULE_V1", subjectType: "cycle", subjectId: cycleId, payload: { userId: mandate.userId, kind: "failed.limit" } });
  }
  return { status: r.status, actionId: r.actionId, reason: r.reason };
}

export function refundAnswer(s: Session, at: ISO, executionId: string, yes: boolean, opts: { autoplayed?: boolean } = {}): DecisionOutcome {
  const r = s.state.refunds.get(executionId);
  if (!r || r.status !== "offered") return { status: "ignored" };
  if (!yes) {
    s.emit({ actor: "customer", simAt: at, type: "decision_recorded", subjectType: "mandate", subjectId: r.mandateId, payload: { cycleId: r.cycleId, mandateId: r.mandateId, executionId, choice: "refund_no", refund: true } });
    return { status: "executed" };
  }
  const settings = s.settings(r.merchantId);
  const charge = s.state.executions.get(executionId)!;
  const withinWindow = ms(at) - ms(charge.at) <= settings.refundWindowHours * 3_600_000;
  const auto = settings.refundAuto && withinWindow && r.amount <= settings.refundCap;
  const res = run(s, at, {
    type: "requestRefund", ruleId: auto ? "REFUND_AUTO_V1" : "REFUND_MERCHANT_V1", actor: "rule", targetId: executionId,
    discriminator: auto ? "auto" : "merchant_queue",
    params: { executionId, amount: r.amount, mandateId: r.mandateId, path: auto ? "auto" : "merchant_queue", autoplayed: opts.autoplayed },
  });
  return { status: res.status, actionId: res.actionId, reason: res.reason };
}

export type CaseSummary = ReturnType<typeof templateSummary> & { review?: ReviewStamp };
/** ctx.names: the customer's name, masked before any model sees the facts. */
type Summarizer = (facts: { code: string; caseType: string; template: CaseSummary }, tpl: CaseSummary, ctx: { names: string[] }) => CaseSummary;
let summarizer: Summarizer = (_f, tpl) => tpl;
/** Plug in the L4 model (demo cache or live). It must return a validated summary or the template. */
export function setSummarizer(fn: Summarizer) { summarizer = fn; }

export function caseSummary(s: Session, code: string, merchantPosition?: string): CaseSummary {
  const tpl = templateSummary(s, code, merchantPosition);
  const u = s.idx.user.get(s.idx.mandate.get(s.state.cases.get(code)!.mandateId)!.userId);
  return summarizer({ code, caseType: s.state.cases.get(code)!.type, template: tpl }, tpl, { names: u ? [u.name] : [] });
}

function templateSummary(s: Session, code: string, merchantPosition?: string) {
  const cs = s.state.cases.get(code)!;
  const m = s.idx.mandate.get(cs.mandateId)!;
  const mer = s.idx.merchant.get(m.merchantId)!;
  const plan = s.idx.plan.get(m.planId)!;
  const u = s.idx.user.get(m.userId)!;
  const usage = s.idx.usage.get(m.id);
  const charge = cs.executionId ? s.state.executions.get(cs.executionId) : undefined;
  const amount = inr(cs.amount);
  if (cs.type === "fraud") {
    return {
      summary: [`${u.name} says they never set up a ${amount} ${mer.brand} AutoPay.`, "The mandate has no recorded PIN authorisation on this account.", "Fraud lane steps were shown and a person review is open."],
      customer_ask: "Stop the charges and review an AutoPay they say they never approved.",
      rules_said: "FRAUD_LANE_V1: never routed through the merchant refund path.",
      merchant_position: "Not asked. Fraud cases do not go to the merchant first.",
      evidence: [`Charge ${amount} on 25 Oct`, "No PIN authorisation on record for this mandate", "Customer statement through Pakka se poochho"],
      suggested_next_step: "Confirm with the issuer bank whether the mandate was registered with AFA, and help the customer file with 1930.",
      suggestion_confidence: "medium", risk_flags: ["fraud_claim"] as string[], modelVersion: "template",
    };
  }
  return {
    summary: [
      `${u.name} asked for a refund of ${amount} for ${plan.name}.`,
      `The amount is above ${mer.brand}'s auto refund cap, so it went to ${mer.brand}, which declined it.`,
      `Usage signal, shared with consent, says the app was not opened after the trial.`,
    ],
    customer_ask: `Refund of ${amount}; says the app was not used.`,
    rules_said: `REFUND_AUTO_V1 did not apply (cap ${inr(s.settings(mer.id).refundCap)}). REFUND_MERCHANT_V1 sent it to ${mer.brand}.`,
    merchant_position: merchantPosition ?? cs.merchantPosition ?? "",
    evidence: [
      m.trialStartedAt ? `Trial started ${dayMonth(m.trialStartedAt, "en")}` : "No trial",
      charge ? `Charged ${amount} on ${dayMonth(charge.at, "en")}` : "Charge on record",
      usage && m.usageConsent ? `App opened since trial: ${usage.openedSinceTrial ? "yes" : "no"} (consented)` : "No consented usage signal",
    ],
    suggested_next_step: `Ask ${mer.brand} to refund as a goodwill exception, pointing to the usage evidence.`,
    suggestion_confidence: "medium", risk_flags: [] as string[], modelVersion: "template",
  };
}

/** Callback window: by 4:30 PM next day when assigned after 2 PM, else three hours later. */
function callbackBy(at: ISO): ISO {
  if (istMinutes(new Date(at)) >= 14 * 60) {
    const nextDay = new Date(ms(at) + 86_400_000);
    return ist(`${istDay(nextDay.toISOString())} 16:30`);
  }
  return addMin(at, 180);
}

function escalate(s: Session, at: ISO, code: string, merchantPosition?: string) {
  const cs = s.state.cases.get(code)!;
  run(s, at, { type: "assignHuman", ruleId: "ESCALATE_HUMAN_V1", actor: "rule", targetId: code, params: { mandateId: cs.mandateId, summary: caseSummary(s, code, merchantPosition) } });
  const callbackCode = s.world.fixtures.callbackCodes[cs.mandateId] ?? String(1000 + (parseInt(sha256(code).slice(0, 6), 16) % 9000));
  run(s, addSec(at, 3), { type: "bookCallback", ruleId: "ESCALATE_HUMAN_V1", actor: "rule", targetId: code, params: { mandateId: cs.mandateId, by: callbackBy(at), callbackCode } });
}

export function merchantRefundDecision(s: Session, at: ISO, executionId: string, decision: "approve" | "decline", reason?: string): DecisionOutcome {
  const r = s.state.refunds.get(executionId);
  if (!r || r.status !== "with_merchant") return { status: "ignored" };
  s.emit({ actor: "merchant", simAt: at, type: "merchant_decision", subjectType: "case", subjectId: r.caseCode, payload: { executionId, decision, reason, caseCode: r.caseCode } });
  if (decision === "approve") {
    const res = run(s, addSec(at, 1), { type: "requestRefund", ruleId: "REFUND_MERCHANT_V1", actor: "merchant", targetId: executionId, discriminator: "approve", params: { executionId, amount: r.amount, mandateId: r.mandateId, path: "merchant_approved" } });
    return { status: res.status, actionId: res.actionId };
  }
  // The customer said they did not use the service, so a decline goes to a person.
  escalate(s, addSec(at, 1), r.caseCode!, reason);
  return { status: "escalated" };
}

export function personDecision(s: Session, at: ISO, code: string, decision: "refund" | "uphold" | "need_info", reason: string, by = PERSON, opts: { autoplayed?: boolean } = {}): DecisionOutcome {
  const cs = s.state.cases.get(code);
  if (!cs || cs.decision || !reason.trim()) return { status: "ignored" };
  s.emit({ actor: "person", ruleId: "PERSON_DECISION_V1", simAt: at, type: "human_decision", subjectType: "case", subjectId: code, payload: { code, decision, reason, by, autoplayed: !!opts.autoplayed } });
  if (decision === "refund" && cs.executionId) {
    const res = run(s, addSec(at, 1), { type: "requestRefund", ruleId: "PERSON_DECISION_V1", actor: "person", targetId: cs.executionId, discriminator: "person", params: { executionId: cs.executionId, amount: cs.amount, mandateId: cs.mandateId, path: "person" } });
    return { status: res.status, actionId: res.actionId };
  }
  if (decision === "uphold") s.emit({ actor: "person", ruleId: "PERSON_DECISION_V1", simAt: addSec(at, 1), type: "case_closed", subjectType: "case", subjectId: code, payload: { code, outcome: "upheld" } });
  return { status: "executed" };
}

export function callbackDone(s: Session, at: ISO, code: string, by = PERSON) {
  const cs = s.state.cases.get(code);
  if (!cs?.callback || cs.callback.doneAt) return;
  s.emit({ actor: "person", simAt: at, type: "callback_done", subjectType: "case", subjectId: code, payload: { code, by } });
}

/** Template intake for "Pakka se poochho" (fallback for the L3 model, PRD 14.5). */
export function intakeTemplate(text: string): Intake {
  const x = text.toLowerCase();
  const amount = x.match(/(?:₹|rs\.?\s?)?(\d[\d,]{1,6})/)?.[1]?.replace(/,/g, "");
  const intent: Intake["intent"] =
    /(kabhi nahi|nahi liya|nahi banaya|maine koi|never (set|approved|used|signed)|not me|didn'?t (sign|approve)|नहीं लिया|कभी नहीं)/.test(x) ? "never_approved"
    : /(refund|wapas|वापस)/.test(x) ? "refund_request"
    : /(cancel|band kar|बंद)/.test(x) ? "cancel_help"
    : /(fail|nahi kata|नहीं कटा)/.test(x) ? "failed_charge"
    : "explain_charge";
  const lang = /[ऀ-ॿ]/.test(text) ? "hi" : /\b(kya|kyun|kaun|hai|mera|paisa|katega|kata)\b/.test(x) ? "hinglish" : "en";
  return { intent, merchant_text: text, amount_rupees: amount ? Number(amount) : null, date_text: null, language: lang };
}

export function askQuestion(s: Session, at: ISO, userId: string, text: string, intake: Intake = intakeTemplate(text), opts: { autoplayed?: boolean } = {}) {
  intake ??= intakeTemplate(text);
  // The log keeps the question masked: phone numbers, UPI IDs, OTPs and the like never reach storage.
  const user = s.idx.user.get(userId);
  const safe = mask(text, { names: user ? [user.name] : [] });
  s.emit({ actor: "customer", simAt: at, type: "question_asked", payload: { userId, text: safe.masked, masked: safe.vault.counts(), autoplayed: !!opts.autoplayed } });
  const res = resolveMandate(s, userId, intake);
  s.emit({ actor: "ai", simAt: addSec(at, 1), type: "question_resolved", modelVersion: intake.modelVersion ?? "template", payload: { userId, text: safe.masked, intent: intake.intent, mandateId: res.mandateId, candidates: res.candidates, reply: intake.reply, review: intake.review } });
  let caseCode: string | undefined;
  if (intake.intent === "never_approved" && res.mandateId) {
    caseCode = s.state.caseByMandate.get(res.mandateId);
    if (!caseCode) {
      const m = s.idx.mandate.get(res.mandateId)!;
      // Seeded history first (demo); in a live world the charges are the ones the engine made.
      const charge = s.world.history.filter((h) => h.mandateId === m.id).at(-1)
        ?? [...s.state.executions.values()].filter((x) => x.result === "success" && s.idx.cycle.get(x.cycleId)?.mandateId === m.id).at(-1);
      const code = nextCaseCode(s, m.id);
      run(s, addSec(at, 2), { type: "openCase", ruleId: "FRAUD_LANE_V1", actor: "rule", targetId: m.id, params: { mandateId: m.id, caseType: "fraud", code, amount: charge?.amount ?? 0, executionId: charge?.id, customerAsk: text } });
      run(s, addSec(at, 3), { type: "assignHuman", ruleId: "FRAUD_LANE_V1", actor: "rule", targetId: code, params: { mandateId: m.id, summary: caseSummary(s, code) } });
      caseCode = code;
    }
  }
  return { intent: intake.intent, mandateId: res.mandateId, candidates: res.candidates, caseCode };
}

export function setMerchantSettings(s: Session, at: ISO, merchantId: string, settings: Partial<MerchantSettings>, by: string, opts: { autoplayed?: boolean } = {}) {
  const issues = Object.values(settings.offerCopy ?? {}).flatMap((txt) => (txt ? lintOffer(txt) : []));
  if (issues.length) return { ok: false as const, issues };
  s.emit({ actor: "merchant", simAt: at, type: "merchant_settings_changed", subjectType: "merchant", subjectId: merchantId, payload: { merchantId, settings, by, autoplayed: !!opts.autoplayed } });
  return { ok: true as const, issues: [] };
}

export function setKillSwitch(s: Session, at: ISO, scope: string, on: boolean, reason: string, by = PERSON) {
  s.emit({ actor: "person", simAt: at, type: "kill_switch_changed", ruleId: "KILL_SWITCH_V1", payload: { scope, on, reason, by } });
  if (on) return;
  // Drain the queue in order with the original idempotency keys.
  // The gateway blocks again anything still covered by another switch.
  for (const key of [...s.state.queued]) {
    const a = s.state.actions.get(key);
    if (a?.replay) run(s, at, a.replay as unknown as Parameters<typeof run>[2]);
  }
}

/** The merchant withdraws a notice on its own after Pakka nudged (STALE_NOTICE_V1): the card updates, nudges stop. */
export function merchantWithdrawNotice(s: Session, at: ISO, cycleId: string) {
  const cs = s.state.cycle(cycleId);
  if (cs.noticeWithdrawn || ["succeeded", "opted_out"].includes(cs.status)) return { status: "ignored" };
  const m = s.mandateOf(cycleId);
  s.emit({ actor: "merchant", simAt: at, type: "notice_withdrawn", subjectType: "cycle", subjectId: cycleId, payload: { cycleId, reason: "stale" } });
  if (cs.nudges > 0) {
    run(s, addSec(at, 1), { type: "sendNudge", ruleId: "STALE_NOTICE_V1", actor: "ai", targetId: m.userId, cycleId, discriminator: "stale", params: { userId: m.userId, kind: "stale" } });
  }
  return { status: "executed" };
}

/** "Hamesha chalne do": the customer says this mandate is wanted, so its score is 0 from now on (PRD 11.4). No PIN. */
export function setAlwaysKeep(s: Session, at: ISO, mandateId: string) {
  if (s.state.alwaysKeep.has(mandateId)) return { status: "duplicate" };
  s.emit({ actor: "customer", simAt: at, type: "decision_recorded", subjectType: "mandate", subjectId: mandateId, payload: { mandateId, choice: "always_keep" } });
  return { status: "executed" };
}

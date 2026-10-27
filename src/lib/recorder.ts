// Flight recorder rows (PRD 20.3, O3): events turned into plain titles. Bookkeeping events
// (executed, verified, informed) are folded away; what's left explains what happened and why.
import { RULES } from "@/engine/rules/catalog";
import type { Session } from "@/engine/session";
import type { Actor, PakkaEvent } from "@/engine/types";
import { dayMonth, inr, timeIST } from "./format";

export interface RecorderRow { id: number; at: string; actor: Actor; title: string; detail: string; chip?: string; event: PakkaEvent }

const CHOICE: Record<string, string> = { keep: "Chalne do", skip: "Is mahine skip karo", pause: "Pause karo", cancel: "AutoPay band karo" };
const LANG: Record<string, string> = { hi: "Hindi", hinglish: "Hinglish", en: "English" };
const HIDDEN = new Set(["action_executed", "action_verified", "customer_informed", "refund_reserved", "review_tagged"]);

export function recorderRow(s: Session, e: PakkaEvent): RecorderRow | null {
  if (HIDDEN.has(e.type)) return null;
  const p = e.payload;
  const cycle = p.cycleId ? s.idx.cycle.get(p.cycleId) : undefined;
  const mandate = cycle ? s.idx.mandate.get(cycle.mandateId) : p.mandateId ? s.idx.mandate.get(p.mandateId) : undefined;
  const mer = mandate ? s.idx.merchant.get(mandate.merchantId) : p.merchantId ? s.idx.merchant.get(p.merchantId) : undefined;
  const user = mandate ? s.idx.user.get(mandate.userId) : p.userId ? s.idx.user.get(p.userId) : undefined;
  const first = user?.name.split(" ")[0] ?? "Customer";
  const r = (title: string, detail = "", chip?: string): RecorderRow => ({ id: e.id, at: e.simAt, actor: e.actor, title, detail, chip, event: e });
  switch (e.type) {
    case "notice_received": return r("Pre-debit notice read", `${inr(p.amount)}, ${mer?.brand}, due after 9:30 PM on ${dayMonth(p.dueAt, "en")}`);
    case "risk_scored":
      if (p.band === "remind_only") return r("Irrevocable mandate, no score", "Remind only", "mandate-risk-v1");
      return r(`Risk score ${p.score}`, (p.contributions as { label: string; points: number }[]).map((c, i) => `${i ? c.label.toLowerCase() : c.label} ${c.points > 0 ? "+" : ""}${c.points}`).join(", "), "mandate-risk-v1");
    case "action_planned": {
      const t = p.actionType;
      if (t === "sendNudge") return r(RULES[e.ruleId as keyof typeof RULES]?.title ?? "Reminder planned", "", e.ruleId);
      if (t === "requestMerchantSkip") return r(p.reason === "no_answer" ? `No answer by the cut-off, ${mer?.brand} asked not to charge` : `Skip requested from ${mer?.brand}`, `Action ${p.actionId}, one request, same key on retry`, e.ruleId);
      if (t === "requestUserOptOut") return r(`${p.kind === "pause" ? "Pause" : "Cancel"} sent to the bank`, `Action ${p.actionId}, needs the customer's PIN`, e.ruleId);
      if (t === "scheduleRetry") return r("Retry booked in the next off-peak slot", `Attempt ${p.attempt}`, e.ruleId);
      if (t === "requestRefund") return r(p.path === "auto" ? `Refund under ${mer?.brand ?? "the merchant"}'s own rule` : p.path === "merchant_queue" ? `Refund sent to ${mer?.brand ?? "the merchant"} to decide` : "Refund requested", `Action ${p.actionId}`, e.ruleId);
      if (t === "executeCharge") return r(`Charge attempt ${p.attempt}`, "Off-peak window, attempts within the limit", e.ruleId);
      if (t === "recordDecision" || t === "openIncident" || t === "alertMerchant" || t === "assignHuman" || t === "bookCallback" || t === "openCase") return null;
      return r(t, "", e.ruleId);
    }
    case "action_blocked": return r(`Blocked: ${p.reason}`, `Action ${p.actionId} (${p.actionType})`, e.ruleId);
    case "action_failed": return r(`Failed: ${p.reason}`, `Action ${p.actionId}`, e.ruleId);
    case "nudge_sent":
      return r(e.modelVersion === "template" ? `Reminder in ${LANG[p.language]}, from the template` : `Reminder written in ${LANG[p.language]}, facts checked`,
        p.pushAt ? (Math.abs(Date.parse(p.pushAt) - Date.parse(e.simAt)) < 60_000 ? `Push sent: ${p.title}` : `Quiet hours, push moved to ${timeIST(p.pushAt)}`) : "In-app card only", e.modelVersion);
    case "decision_recorded":
      if (p.refund) return r(`${first} said no to the refund`);
      return r(`${first} chose "${CHOICE[p.choice] ?? p.choice}"${p.late ? " after the cut-off" : ""}`, p.autoplayed ? "Autoplayed for the demo" : "");
    case "pin_verified": return r("UPI PIN verified", "Demo PIN, no real money");
    case "notice_withdrawn": return r(`${mer?.brand} withdrew the notice`, p.reason === "no_answer" ? "Doosri Haan: no yes, no charge" : `${first} told: kal paisa nahi katega`);
    case "execution_attempted": return null;
    case "execution_succeeded": return r(`${inr(p.amount)} charged`, `Attempt ${p.attempt}`, e.ruleId);
    case "execution_failed": return r(`${inr(p.amount)} not charged`, `Attempt ${p.attempt}, ${p.result === "insufficient_funds" ? "insufficient balance" : p.result}`, e.ruleId);
    case "retry_scheduled": return r(`Retry at ${timeIST(p.executeAt)}`, `${dayMonth(p.executeAt, "en")}, outside peak hours`, e.ruleId);
    case "topup_confirmed": return r(`${first} tapped "Paisa daal diya"`, p.autoplayed ? "Autoplayed for the demo" : "");
    case "refund_offered": return r("Refund offered", `${inr(p.amount)}, app not opened (consented signal)`, e.ruleId);
    case "refund_requested": return r(p.path === "auto" ? "Refund requested, auto path" : `Refund queued for ${mer?.brand ?? "the merchant"}`, p.queuedUntil ? `Merchant SLA until ${timeIST(p.queuedUntil)}, ${dayMonth(p.queuedUntil, "en")}` : inr(p.amount), e.ruleId);
    case "refund_sent": return r(`${inr(p.amount)} refund sent`, "To the original UPI account", e.ruleId);
    case "refund_confirmed": return r("Refund credit seen", "Verified on the bank side");
    case "merchant_decision": return r(`${mer?.brand ?? "Merchant"} ${p.decision === "approve" ? "approved" : "declined"} the refund`, p.reason ?? "");
    case "case_opened": return r(`Case ${p.code} opened`, p.caseType === "fraud" ? "Fraud lane" : p.caseType === "refund" ? "Refund lane" : "", e.ruleId);
    case "case_assigned": return r(`Assigned to ${p.to}`, "", e.ruleId);
    case "case_summary_written": return r("Case summary written", "Suggestion only, not applied", e.modelVersion);
    case "callback_booked": return r(`Callback booked by ${timeIST(p.by)}`, `From a 1600 number, code ${p.callbackCode}`, e.ruleId);
    case "callback_done": return r(`${p.by} spoke with the customer`);
    case "human_decision": return r(`${p.by} decided: ${p.decision === "refund" ? "ask merchant to refund" : p.decision === "uphold" ? "uphold merchant decision" : "need more info"}`, p.reason, e.ruleId);
    case "case_closed": return r(`Case ${p.code} closed`, p.outcome);
    case "incident_opened": return r(`${p.incidentId} opened`, `${p.metrics.count} low-star reviews in 6 hours, threshold ${p.metrics.threshold}`, e.ruleId);
    case "merchant_alerted": return r("Private alert sent to the merchant", p.headline, e.ruleId);
    case "merchant_settings_changed": return r(`${p.by} changed Pakka settings`, Object.entries(p.settings).map(([k, v]) => `${k}: ${v}`).join(", "));
    case "kill_switch_changed": return r(`Kill switch ${p.on ? "on" : "off"}`, `${p.scope}: ${p.reason}`, "KILL_SWITCH_V1");
    case "question_asked": return r(`${first} asked: "${p.text}"`);
    case "question_resolved": return r(`Intent: ${p.intent}`, p.mandateId ? "Matched one mandate, deterministically" : "No single match", e.modelVersion);
    default: return null;
  }
}

/** Every event about a cycle, its mandate, or a case on that mandate. */
export function eventsFor(s: Session, subject: { cycleId?: string; mandateId?: string; caseCode?: string }) {
  const mandateId = subject.mandateId ?? (subject.cycleId ? s.idx.cycle.get(subject.cycleId)?.mandateId : undefined)
    ?? (subject.caseCode ? s.state.cases.get(subject.caseCode)?.mandateId : undefined);
  const cycles = new Set((mandateId ? s.idx.cyclesByMandate.get(mandateId) ?? [] : []).map((c) => c.id));
  const code = subject.caseCode ?? (mandateId ? s.state.caseByMandate.get(mandateId) : undefined);
  const userId = mandateId ? s.idx.mandate.get(mandateId)?.userId : undefined;
  return s.events.filter((e) => {
    const p = e.payload;
    return (e.subjectType === "cycle" && cycles.has(e.subjectId!)) || (p.cycleId && cycles.has(p.cycleId)) || (mandateId && (p.mandateId === mandateId || e.subjectId === mandateId))
      || (code && (p.code === code || p.caseCode === code || e.subjectId === code))
      || (userId && (e.type === "question_asked" || e.type === "question_resolved") && p.userId === userId);
  });
}

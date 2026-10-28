// src/engine/explain.ts: customer-facing text from facts. Templates are the deterministic fallback
// for the L1 writer (PRD 14.3); a cached or live model output can replace them via setWriter().
import { t } from "@/copy/strings";
import { dayMonth, inr, relativeDay, timeIST } from "@/lib/format";
import type { Session } from "./session";
import type { ISO, Lang } from "./types";

export type NudgeKind = "ask" | "tell" | "follow_up" | "collect" | "failed" | "refund_offer" | "remind" | "stale";

export interface Written { title: string; body: string; voice?: string; language: Lang; modelVersion: string; fallback?: string }

export interface ReminderFacts {
  language: Lang; kind: NudgeKind; brand: string; registered_name: string; brand_verified: boolean;
  amount_rupees: number; trial_amount_rupees: number | null; trial_date: string | null; charge_day: string;
  charge_time_text: string; usage: string; choices: string[]; skip_is_merchant_offer: boolean; no_answer_outcome: string;
  cycleId: string;
}

type Writer = (facts: ReminderFacts, template: Written) => Written;
let writer: Writer = (_f, tpl) => tpl;
/** Plug in the L1 model (demo cache or live) here. It must return fact-checked text or the template. */
export function setWriter(w: Writer) { writer = w; }

export function reminderFacts(s: Session, cycleId: string, kind: NudgeKind, at: ISO): ReminderFacts {
  const c = s.idx.cycle.get(cycleId)!;
  const m = s.idx.mandate.get(c.mandateId)!;
  const mer = s.idx.merchant.get(m.merchantId)!;
  const plan = s.idx.plan.get(m.planId)!;
  const u = s.idx.user.get(m.userId)!;
  const st = s.settings(mer.id);
  const usage = s.idx.usage.get(m.id);
  const lang = u.lang;
  return {
    language: lang, kind, brand: mer.brand, registered_name: mer.legalName, brand_verified: mer.brandVerified,
    amount_rupees: c.amount / 100, trial_amount_rupees: plan.trialAmount !== null && c.firstAfterTrial ? plan.trialAmount / 100 : null,
    trial_date: m.trialStartedAt && c.firstAfterTrial ? dayMonth(m.trialStartedAt, lang) : null,
    charge_day: relativeDay(c.dueAt, at, lang),
    charge_time_text: t(lang, "timeline.after", { time: "9:30 PM" }),
    usage: m.usageConsent && usage ? (usage.openedSinceTrial ? "opened" : "not_opened") : "unknown",
    choices: ["keep", ...(st.offerSkip ? ["skip"] : []), ...(st.offerDowngradePlanId ? ["downgrade"] : []), "pause", "cancel"],
    skip_is_merchant_offer: st.offerSkip,
    no_answer_outcome: st.askBeforeFirstCharge && c.firstAfterTrial ? "not_charged" : "charged",
    cycleId,
  };
}

export function writeNudge(s: Session, cycleId: string, kind: NudgeKind, at: ISO): Written {
  const f = reminderFacts(s, cycleId, kind, at);
  const L = f.language;
  const amount = inr(f.amount_rupees * 100);
  const p = { day: f.charge_day, amount, brand: f.brand, trialDate: f.trial_date ?? "", trialAmount: f.trial_amount_rupees !== null ? inr(f.trial_amount_rupees * 100) : "" };
  const c = s.idx.cycle.get(cycleId)!;
  let tpl: Written;
  switch (kind) {
    case "ask":
      tpl = { title: t(L, "push.ask", p), body: f.trial_date ? t(L, "push.ask.body", p) : t(L, "sheet.lede.first"), language: L, modelVersion: "template" };
      break;
    case "follow_up":
      tpl = { title: t(L, "push.followup", p), body: t(L, f.no_answer_outcome === "not_charged" ? "noanswer.dh" : "noanswer.default", p), language: L, modelVersion: "template" };
      break;
    case "tell":
      tpl = { title: t(L, "push.tell", p), body: t(L, "noanswer.default", p), language: L, modelVersion: "template" };
      break;
    case "collect":
      tpl = { title: t(L, "collect.push", p), body: t(L, "pill.balance"), language: L, modelVersion: "template" };
      break;
    case "failed":
      tpl = { title: t(L, "failed.title", p), body: t(L, "push.failed", p), language: L, modelVersion: "template" };
      break;
    case "refund_offer":
      tpl = { title: t(L, "refund.offer", { ...p, date: dayMonth(c.dueAt, L) }), body: "", language: L, modelVersion: "template" };
      break;
    case "remind":
      tpl = { title: t(L, "push.remind", { ...p, date: dayMonth(c.dueAt, L) }), body: t(L, "row.irrevocable"), language: L, modelVersion: "template" };
      break;
    case "stale":
      tpl = { title: t(L, "push.stale"), body: f.brand, language: L, modelVersion: "template" };
      break;
  }
  return writer(f, tpl);
}

export function chargeTimeText(lang: Lang, dueAt: ISO) {
  return t(lang, "row.after", { time: timeIST(dueAt) });
}

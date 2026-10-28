// src/engine/metrics.ts: counters for the demo view (PRD 25.6). Everything is read from replayed state
// and the event log; nothing is typed in.
import { DEMO_END, ms, SESSION_START } from "./clock";
import type { Session } from "./session";
import type { Lang } from "./types";

const inWindow = (iso: string) => ms(iso) > ms(SESSION_START) && ms(iso) <= ms(DEMO_END);

export interface Metrics {
  unwantedStopped: number; unwantedStoppedCount: number; unwantedUnit: number;
  atRiskCollected: number; atRiskCollectedCount: number; atRiskTotal: number; atRiskUnit: number;
  keptBySkipOrPause: number;
  refundedUnderMerchantRules: number;
  casesToPerson: number;
  movedWithoutRule: number;
  choiceBreakdown: { keep: number; skip: number; downgrade: number; pause: number; cancel: number; none: number };
  asked: number;
  sweep: { active: number; dueFirst: number; confirmed: number; needYes: number; remindersByLang: Record<Lang, number> };
}

export function metrics(s: Session): Metrics {
  const st = s.state;
  const ask = s.world.cycles.filter((c) => c.group === "ask" && inWindow(c.dueAt));
  const stopped = ask.filter((c) => { const x = st.cycle(c.id).status; return x === "skipped" || x === "opted_out"; });
  const choice = { keep: 0, skip: 0, downgrade: 0, pause: 0, cancel: 0, none: 0 };
  let kept = 0;
  for (const c of ask) {
    const cs = st.cycle(c.id);
    const d = cs.decision;
    if (d === "keep" || d === "skip" || d === "downgrade" || d === "pause" || d === "cancel") choice[d]++; else choice.none++;
    if ((cs.status === "skipped" && cs.skipReason === "customer") || (cs.status === "opted_out" && cs.optOutKind === "pause")) kept++;
  }
  const collect = s.world.cycles.filter((c) => c.group === "collect" && inWindow(c.dueAt));
  const collected = collect.filter((c) => st.cycle(c.id).status === "succeeded");

  let refunded = 0, toPerson = 0, noRule = 0;
  const remindersByLang: Record<Lang, number> = { hi: 0, hinglish: 0, en: 0 };
  for (const e of s.events) {
    if (e.type === "refund_sent" && e.ruleId === "REFUND_AUTO_V1") refunded += e.payload.amount;
    if (e.type === "case_assigned") toPerson++;
    const money = (e.type === "action_executed" && e.payload.money) || e.type === "execution_succeeded" || e.type === "refund_sent";
    if (money && !e.ruleId) noRule++;
    if (e.type === "nudge_sent" && e.payload.kind === "ask" && (e.ruleId === "DH_ASK_V1" || e.ruleId === "PAKKA_ASK_V1")) remindersByLang[e.payload.language as Lang]++;
  }
  const padho = s.world.cycles.filter((c) => (c.group === "ask" || c.group === "confirmed") && inWindow(c.dueAt));
  return {
    unwantedStopped: stopped.reduce((a, c) => a + c.amount, 0), unwantedStoppedCount: stopped.length, unwantedUnit: ask[0]?.amount ?? 0,
    atRiskCollected: collected.reduce((a, c) => a + c.amount, 0), atRiskCollectedCount: collected.length, atRiskTotal: collect.length, atRiskUnit: collect[0]?.amount ?? 0,
    keptBySkipOrPause: kept,
    refundedUnderMerchantRules: refunded,
    casesToPerson: toPerson,
    movedWithoutRule: noRule,
    choiceBreakdown: choice,
    asked: ask.filter((c) => st.cycle(c.id).nudges > 0).length,
    sweep: {
      active: s.world.mandates.filter((m) => m.merchantId === "m_padhoai" && st.mandateStatus.get(m.id) === "active").length,
      dueFirst: padho.length,
      confirmed: padho.filter((c) => c.confirmedInMerchantAppAt).length,
      needYes: padho.filter((c) => !c.confirmedInMerchantAppAt).length,
      remindersByLang,
    },
  };
}

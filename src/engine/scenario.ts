// src/engine/scenario.ts: scripted actors for the demo (PRD 25.5). Plays everyone who is not on a
// real screen, through the same entry points a real tap uses. Persona fallbacks are marked autoplayed.
import { ist } from "./clock";
import { askQuestion, callbackDone, customerDecision, merchantRefundDecision, personDecision, refundAnswer, setMerchantSettings, topupConfirmed, verifyPin } from "./actions";
import { merchantRetry, type Job } from "./agent";
import type { Session } from "./session";
import type { World } from "./types";

export const AUTOPLAY = {
  imranSaves: ist("2026-10-26 21:06"),
  anjaliAsks: ist("2026-10-27 10:00"),
  priyaCalls: ist("2026-10-27 15:52"),
  priyaDecides: ist("2026-10-27 16:00"),
};

export function scriptedJobs(w: World): Job[] {
  const jobs: Job[] = [
    { at: AUTOPLAY.imranSaves, pri: 2, kind: "settings_autoplay", ref: "m_padhoai" },
    { at: AUTOPLAY.anjaliAsks, pri: 7, kind: "anjali_question", ref: "u_anjali" },
    { at: AUTOPLAY.priyaCalls, pri: 7, kind: "callback_autoplay", ref: "PAK-2311" },
    { at: AUTOPLAY.priyaDecides, pri: 7, kind: "person_autoplay", ref: "PAK-2311" },
  ];
  for (const s of w.scripted) {
    if (s.answer && s.answer.choice !== "none") jobs.push({ at: s.answer.at, pri: 7, kind: "answer", ref: s.cycleId });
    if (s.refund) {
      jobs.push({ at: s.refund.askAt, pri: 7, kind: "refund_answer", ref: s.cycleId });
      if (s.refund.merchantDecision) jobs.push({ at: s.refund.merchantDecision.at, pri: 7, kind: "merchant_refund_decision", ref: s.cycleId });
    }
    if (s.topupAt) jobs.push({ at: s.topupAt, pri: 7, kind: "topup", ref: s.cycleId });
    if (s.merchantRetryAt) jobs.push({ at: s.merchantRetryAt, pri: 7, kind: "merchant_retry", ref: s.cycleId });
  }
  return jobs;
}

const isPersonaCycle = (s: Session, cycleId: string) => !!s.userOf(s.idx.cycle.get(cycleId)!.mandateId).persona;

export function handle(s: Session, j: Job) {
  const sc = s.idx.scripted.get(j.ref);
  switch (j.kind) {
    case "settings_autoplay":
      if (!s.state.settingsChangedBy.has(j.ref)) {
        setMerchantSettings(s, j.at, j.ref, { askBeforeFirstCharge: true, offerSkip: true }, "Imran Sheikh", { autoplayed: true });
      }
      return;
    case "answer": {
      const cs = s.state.cycle(j.ref);
      if (cs.decision || !sc?.answer || sc.answer.choice === "none") return;
      const choice = sc.answer.choice;
      let pinToken: string | undefined;
      if (choice === "pause" || choice === "cancel") {
        const r = verifyPin(s, j.at, s.mandateOf(j.ref).userId, "246810");
        if ("pinToken" in r) pinToken = r.pinToken;
      }
      customerDecision(s, j.at, j.ref, choice, { pinToken, autoplayed: isPersonaCycle(s, j.ref) });
      return;
    }
    case "refund_answer":
      refundAnswer(s, j.at, `ex_${j.ref}_1`, true, { autoplayed: isPersonaCycle(s, j.ref) });
      return;
    case "merchant_refund_decision": {
      const d = sc?.refund?.merchantDecision;
      if (d) merchantRefundDecision(s, j.at, `ex_${j.ref}_1`, d.decision, d.reason);
      return;
    }
    case "topup":
      if (!s.state.cycle(j.ref).topupAt) topupConfirmed(s, j.at, j.ref, { autoplayed: isPersonaCycle(s, j.ref) });
      return;
    case "merchant_retry":
      return merchantRetry(s, j.ref, j.at);
    case "anjali_question":
      if (!s.state.questions.some((q) => q.userId === j.ref && q.intent === "never_approved")) {
        askQuestion(s, j.at, j.ref, "maine koi app nahi liya, 599 kaise kata?", undefined, { autoplayed: true });
      }
      return;
    case "callback_autoplay":
      return callbackDone(s, j.at, j.ref);
    case "person_autoplay":
      if (s.state.cases.get(j.ref)?.status === "with_person") {
        personDecision(s, j.at, j.ref, "refund", "No app opens after purchase per the consented usage signal. Goodwill exception.", "Priya Nair", { autoplayed: true });
      }
      return;
  }
}

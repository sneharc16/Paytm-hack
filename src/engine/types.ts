// src/engine/types.ts (PRD 24.2 and 24.3)
export type Lang = "hi" | "hinglish" | "en";
export type Paise = number; // integer
export type ISO = string; // UTC ISO timestamp

export type MerchantCategory =
  | "edtech" | "sports" | "audio" | "video" | "fitness" | "music" | "news" | "storage"
  | "mealkit" | "carcare" | "mutual_fund" | "electricity" | "loan" | "insurance";

export interface Merchant {
  id: string;
  brand: string;
  legalName: string;
  brandVerified: boolean;
  category: MerchantCategory;
  knownObligation: boolean;
  tile: { bg: string; fg: string };
  settings: MerchantSettings; // starting values; changes arrive as events
}

export interface MerchantSettings {
  askBeforeFirstCharge: boolean; // Doosri Haan
  shareUsageSignal: boolean;
  offerSkip: boolean;
  offerDowngradePlanId: string | null;
  refundAuto: boolean;
  refundWindowHours: number;
  refundCap: Paise;
  refundDailyLimit: Paise;
  offerCopy: Partial<Record<Lang, string>>;
}

export interface Plan {
  id: string; merchantId: string; name: string; amount: Paise;
  interval: "month" | "quarter" | "year"; trialAmount: Paise | null; trialDays: number | null;
}

export type Persona = "sunita" | "rahul" | "farhan" | "anjali";
export interface User { id: string; name: string; initials: string; city: string; lang: Lang; persona?: Persona }

export interface Mandate {
  id: string;
  umn: string;
  userId: string; merchantId: string; planId: string;
  createdVia: "paytm" | "other_app";
  visibleViaInterop: boolean;
  irrevocable: boolean;
  amountRule: "fixed" | "max";
  maxAmount: Paise;
  validityEnd: ISO;
  trialStartedAt: ISO | null;
  usageConsent: boolean;
  createdAuth: { method: "upi_pin"; device: string; at: ISO } | null; // null only for fraud-lane fixtures
}

/** Which demo lane a generated cycle belongs to. Used by the generator, tests and metrics. */
export type CycleGroup =
  | "ask" // PadhoAI first charge after trial, needs a yes (318)
  | "confirmed" // PadhoAI first charge, confirmed in merchant app (92)
  | "refund" // PadhoAI first charge already taken, refund lane (27)
  | "collect" // StadiumPass, last charge failed (260)
  | "ordinary"; // everything else

export interface Cycle {
  id: string;
  mandateId: string;
  seq: number;
  dueAt: ISO; // scheduled execution time, always off-peak
  noticeAt: ISO; // when the bank's pre-debit notice arrives
  amount: Paise;
  firstAfterTrial: boolean;
  confirmedInMerchantAppAt: ISO | null;
  group: CycleGroup;
}

/** A charge that happened before the demo window starts. */
export interface PastExecution {
  id: string; cycleId: string; mandateId: string; at: ISO; amount: Paise;
  result: "success" | "insufficient_funds";
}

export interface UsageSignal { mandateId: string; openedSinceTrial: boolean; reportedAt: ISO }

export type Gap = "consent" | "name" | "ownership" | "failed_wanted" | "other";
export interface Review {
  id: string; merchantId: string; rating: 1 | 2 | 3 | 4 | 5; text: string; lang: Lang;
  postedAt: ISO; author: string; goldGap?: Gap;
}

export type Choice = "keep" | "skip" | "pause" | "cancel" | "downgrade";

export interface ScriptedOutcome {
  cycleId: string;
  answer?: { choice: Choice | "none"; at: ISO };
  executionResults?: ("success" | "insufficient_funds")[]; // per attempt
  topupAt?: ISO; // collect lane: customer taps "Paisa daal diya"
  merchantRetryAt?: ISO; // collect lane: merchant's own retry without a top-up
  refund?: { askAt: ISO; merchantDecision?: { decision: "approve" | "decline"; at: ISO; reason?: string } };
}

export interface World {
  seed: string;
  users: User[];
  merchants: Merchant[];
  plans: Plan[];
  mandates: Mandate[];
  cycles: Cycle[];
  history: PastExecution[];
  usage: UsageSignal[];
  reviews: Review[];
  scripted: ScriptedOutcome[];
  fixtures: {
    caseCodes: Record<string, string>; // mandateId -> fixed case code
    callbackCodes: Record<string, string>; // mandateId -> 4 digit code
    actionIds: Record<string, string>; // "cycleId|choice" -> display action id
    retryOffsetMin: Record<string, number>; // cycleId -> minutes after the off-peak slot opens
  };
}

// ---------- events ----------

export type Actor = "ai" | "rule" | "customer" | "merchant" | "person" | "system";

export type EventType =
  | "session_started" | "clock_changed" | "kill_switch_changed"
  | "notice_received" | "notice_withdrawn" | "execution_attempted" | "execution_succeeded" | "execution_failed" | "retry_scheduled"
  | "risk_scored" | "review_tagged" | "incident_opened" | "merchant_alerted"
  | "merchant_settings_changed" | "merchant_decision"
  | "nudge_sent" | "nudge_opened" | "decision_recorded" | "pin_verified" | "question_asked" | "question_resolved" | "topup_confirmed"
  | "action_planned" | "action_blocked" | "action_executed" | "action_verified" | "action_failed" | "customer_informed"
  | "refund_offered" | "refund_requested" | "refund_reserved" | "refund_sent" | "refund_confirmed"
  | "case_opened" | "case_assigned" | "case_summary_written" | "callback_booked" | "callback_done" | "human_decision" | "case_closed";

export interface PakkaEvent {
  id: number;
  sessionId: string;
  simAt: ISO;
  type: EventType;
  actor: Actor;
  subjectType?: "cycle" | "mandate" | "case" | "merchant" | "incident" | "session";
  subjectId?: string;
  ruleId?: string; // required for any money-affecting action
  modelVersion?: string;
  idempotencyKey?: string;
  // Payloads are validated per type at the API boundary; inside the engine they are plain data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
}

export type NewEvent = Omit<PakkaEvent, "id" | "sessionId">;

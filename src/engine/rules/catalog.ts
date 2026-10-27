// The rules catalogue (PRD 12). Every action carries one of these IDs.
// Logic lives where the rule fires: agent.ts (time-driven) and actions.ts (people-driven);
// this file is the single list of IDs, lanes and plain-language descriptions shown in the UI.
export type Lane = "ask" | "collect" | "refund" | "person" | "fraud" | "remind" | "any" | "merchant" | "radar" | "charges";

export const RULES = {
  DH_ASK_V1: { lane: "ask", title: "Merchant needs a yes before charging", pin: false },
  PAKKA_ASK_V1: { lane: "ask", title: "High score, Pakka asks; charge goes ahead on silence", pin: false },
  TELL_V1: { lane: "ask", title: "One quiet heads-up", pin: false },
  KEEP_V1: { lane: "ask", title: "Customer said keep", pin: false },
  SKIP_VIA_MERCHANT_V1: { lane: "ask", title: "Skip requested from the merchant", pin: false },
  DOWNGRADE_VIA_MERCHANT_V1: { lane: "ask", title: "Move to the cheaper plan from next cycle", pin: false },
  USER_OPT_OUT_V1: { lane: "ask", title: "Customer paused or cancelled with their PIN", pin: true },
  FOLLOW_UP_V1: { lane: "ask", title: "One follow-up at T minus 3 hours", pin: false },
  COLLECT_ASSIST_V1: { lane: "collect", title: "Last charge failed on balance, heads-up before this one", pin: false },
  FAILED_INFORM_V1: { lane: "collect", title: "Charge failed on balance, customer told", pin: false },
  RETRY_SCHEDULE_V1: { lane: "collect", title: "Retry booked in the next off-peak slot", pin: false },
  REFUND_OFFER_V1: { lane: "refund", title: "Refund offered for an unused first charge", pin: false },
  REFUND_AUTO_V1: { lane: "refund", title: "Refunded under the merchant's own rule", pin: false },
  REFUND_MERCHANT_V1: { lane: "refund", title: "Refund sent to the merchant to decide", pin: false },
  ESCALATE_HUMAN_V1: { lane: "person", title: "Handed to a person", pin: false },
  FRAUD_LANE_V1: { lane: "fraud", title: "Customer says they never approved this", pin: false },
  REMIND_ONLY_V1: { lane: "remind", title: "Irrevocable mandate, reminder only", pin: false },
  STALE_NOTICE_V1: { lane: "any", title: "Notice changed after the reminder", pin: false },
  QUIET_HOURS_V1: { lane: "any", title: "Push moved out of quiet hours", pin: false },
  NAG_CAP_V1: { lane: "any", title: "Push dropped by the nag cap", pin: false },
  OFFER_LINT_V1: { lane: "merchant", title: "Offer copy checked for dark patterns", pin: false },
  CONSENT_USAGE_V1: { lane: "any", title: "Usage signal used only with consent", pin: false },
  INCIDENT_V1: { lane: "radar", title: "Review spike, incident opened", pin: false },
  KILL_SWITCH_V1: { lane: "any", title: "Kill switch on, Pakka actions paused", pin: false },
  MANDATE_SCHEDULE_V1: { lane: "charges", title: "Merchant's scheduled charge under the mandate", pin: false },
  PERSON_DECISION_V1: { lane: "person", title: "A person decided the case", pin: false },
} as const satisfies Record<string, { lane: Lane; title: string; pin: boolean }>;

export type RuleId = keyof typeof RULES;

/** Rule order within one tick (PRD 12.1). */
export const RULE_ORDER: RuleId[] = [
  "KILL_SWITCH_V1", "REMIND_ONLY_V1", "FRAUD_LANE_V1", "STALE_NOTICE_V1",
  "KEEP_V1", "SKIP_VIA_MERCHANT_V1", "USER_OPT_OUT_V1", "DOWNGRADE_VIA_MERCHANT_V1",
  "DH_ASK_V1", "RETRY_SCHEDULE_V1", "REFUND_AUTO_V1", "REFUND_MERCHANT_V1", "REFUND_OFFER_V1",
  "PAKKA_ASK_V1", "TELL_V1", "FOLLOW_UP_V1", "COLLECT_ASSIST_V1", "FAILED_INFORM_V1",
  "QUIET_HOURS_V1", "NAG_CAP_V1",
];

// src/llm/agents/rubric.ts: the review rubric as data. Prompts, code checks and tests all read this list, so
// there is one definition of "approved": every criterion that applies to the task passes. Each criterion is
// a test two people would score the same way; none asks for "the best" or "a good" response.

export type ReviewTask = "reminder" | "intake" | "case_summary" | "alert";
export const REVIEWED_TASKS: ReviewTask[] = ["reminder", "intake", "case_summary", "alert"];
export const isReviewed = (t: string): t is ReviewTask => (REVIEWED_TASKS as string[]).includes(t);

export const RUBRIC_VERSION = "rubric-v1";

export interface Criterion {
  id: string;
  name: string;
  /** Passes when ... (the plain-language test). */
  passes: string;
  /** What the reviewer must quote on a fail. */
  evidence: string;
  /** "code" criteria are decided by checks.ts and the reviewer may not overrule a failed one. */
  checkedBy: ("code" | "reviewer")[];
  tasks: ReviewTask[];
}

const CUSTOMER: ReviewTask[] = ["reminder", "intake"];
const ALL = REVIEWED_TASKS;

/** Length limits per task and field, in characters (R7). */
export const LIMITS: Record<ReviewTask, Record<string, number>> = {
  reminder: { title: 60, body: 160, voice_script: 450 },
  intake: { reply: 240 },
  case_summary: { summary: 200, customer_ask: 200, rules_said: 240, merchant_position: 200, evidence: 160, suggested_next_step: 240 },
  alert: { headline: 90, detail: 200 },
};

export const MAX_SENTENCE_WORDS = 20;
/** Words a customer should not have to know (R8). Matched case-insensitively. */
export const JARGON = ["e-mandate", "emandate", "npci", "debit authorisation", "debit authorization", "umn", "afa", "pre-debit notification", "nach"];
export const ALERT_PRIVACY_LINE = "Only you and Paytm's merchant team can see this.";
/** Token types a task's text may contain (R9). Voice scripts may contain none. */
export const ALLOWED_TOKENS: Record<ReviewTask, string[]> = { reminder: [], intake: [], case_summary: ["NAME"], alert: [] };

export const RUBRIC: Criterion[] = [
  { id: "R1", name: "Facts only", passes: "Every amount, number, date, time, brand, plan and case ID in the draft appears exactly in FACTS; nothing is invented.", evidence: "The invented or changed item.", checkedBy: ["code", "reviewer"], tasks: ALL },
  { id: "R2", name: "Required content", passes: "The task's required content is present (see REQUIRED).", evidence: "What is missing.", checkedBy: ["code", "reviewer"], tasks: ALL },
  { id: "R3", name: "Allowed actions only", passes: "Offers only actions listed in FACTS for this mandate (for example no pause, skip or cancel on an irrevocable loan EMI), and promises no refund unless FACTS says it is approved.", evidence: "The action that is not allowed.", checkedBy: ["reviewer"], tasks: CUSTOMER },
  { id: "R4", name: "No money decision", passes: "Does not say money will move, stop or come back unless FACTS says the system has already decided it.", evidence: "The sentence that decides about money.", checkedBy: ["reviewer"], tasks: ["reminder", "intake", "case_summary"] },
  { id: "R5", name: "Neutral choices", passes: "No choice is recommended, ranked or made to look like the right one; no guilt, false urgency or fear; no banned word.", evidence: "The words that push a choice or create urgency.", checkedBy: ["code", "reviewer"], tasks: CUSTOMER },
  { id: "R6", name: "Language and script", passes: "Written fully in the requested language. Hindi: at least 60% of letters in Devanagari. Hinglish and English: under 5% Devanagari.", evidence: "The share of Devanagari letters.", checkedBy: ["code"], tasks: ALL },
  { id: "R7", name: "Length", passes: "Every field is within the task's character limits (see LIMITS).", evidence: "The field and its length.", checkedBy: ["code"], tasks: ALL },
  { id: "R8", name: "Plain words", passes: `Every sentence has ${MAX_SENTENCE_WORDS} words or fewer, and customer text has no jargon (${JARGON.join(", ")}).`, evidence: "The long sentence or the jargon word.", checkedBy: ["code", "reviewer"], tasks: ALL },
  { id: "R9", name: "Privacy", passes: "No personal value (phone, UPI ID, account, card, Aadhaar, PAN, OTP) and no unknown token; tokens only where the task allows them; none in a voice script.", evidence: "The personal value or token.", checkedBy: ["code"], tasks: ALL },
  { id: "R10", name: "Safety routing", passes: "If the customer says they never approved a charge, the reply points to the fraud lane and the 1930 helpline. A trial charge is never called fraud.", evidence: "The missing route or the wrong label.", checkedBy: ["code", "reviewer"], tasks: ["reminder", "intake", "case_summary"] },
  { id: "R11", name: "AI disclosure", passes: "Customer-facing text does not claim to be a person or to have a name, family or feelings.", evidence: "The words that claim to be a person.", checkedBy: ["reviewer"], tasks: CUSTOMER },
  { id: "L4-S", name: "Suggestion, not decision", passes: "The suggested next step is written as a suggestion for the trust specialist (Priya) to decide, never as a decision already made.", evidence: "The words that decide the case.", checkedBy: ["reviewer"], tasks: ["case_summary"] },
  { id: "L6-P", name: "Privacy line and no adjectives", passes: `The detail contains exactly "${ALERT_PRIVACY_LINE}" and no adjective describes the merchant.`, evidence: "The missing line or the adjective.", checkedBy: ["code", "reviewer"], tasks: ["alert"] },
];

/** What R2 requires, per task. */
export const REQUIRED: Record<ReviewTask, string> = {
  reminder: "The title contains the brand and the amount exactly as in FACTS (amount_text). The charge day (charge_day) appears in the title, body or voice script.",
  intake: "A non-empty reply in the customer's language that answers the message using only FACTS.",
  case_summary: "Exactly three summary sentences, and a non-empty suggested_next_step.",
  alert: "A headline and a detail that use the numbers in METRICS.",
};

export const criteriaFor = (task: ReviewTask) => RUBRIC.filter((c) => c.tasks.includes(task));

/** The rubric as the agents see it. */
export function rubricText(task: ReviewTask): string {
  const lim = Object.entries(LIMITS[task]).map(([k, v]) => `${k} ${v}`).join(", ");
  return [
    ...criteriaFor(task).map((c) => `${c.id} ${c.name}: passes when ${c.passes}${c.checkedBy.includes("code") ? " [also checked by code]" : ""}`),
    `REQUIRED: ${REQUIRED[task]}`,
    `LIMITS (characters): ${lim}`,
    `TOKENS ALLOWED: ${ALLOWED_TOKENS[task].length ? ALLOWED_TOKENS[task].join(", ") : "none"}`,
  ].join("\n");
}

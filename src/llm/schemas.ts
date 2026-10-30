// Zod schemas for every model output (PRD 14). Invalid output is treated as a failure.
import { z } from "zod";

export const ReminderOut = z.object({
  title: z.string(), body: z.string(), voice_script: z.string(), language: z.enum(["hi", "hinglish", "en"]),
});
export const TagOut = z.object({
  gap: z.enum(["consent", "name", "ownership", "failed_wanted", "other"]),
  merchant_mentions: z.array(z.string()), amounts: z.array(z.number()),
  language: z.enum(["hi", "hinglish", "en", "other"]), confidence: z.number(), evidence: z.string(),
});
export const IntakeOut = z.object({
  intent: z.enum(["explain_charge", "refund_request", "cancel_help", "never_approved", "failed_charge", "other"]),
  merchant_text: z.string().nullable(), amount_rupees: z.number().nullable(), date_text: z.string().nullable(),
  language: z.enum(["hi", "hinglish", "en"]),
});
export const CaseOut = z.object({
  summary: z.array(z.string()), customer_ask: z.string(), rules_said: z.string(), merchant_position: z.string(),
  evidence: z.array(z.string()), suggested_next_step: z.string(), suggestion_confidence: z.enum(["low", "medium", "high"]),
  risk_flags: z.array(z.string()),
});
export const LintOut = z.object({
  pass: z.boolean(),
  issues: z.array(z.object({ pattern: z.string(), span: z.string(), why: z.string(), suggested_fix: z.string() })),
});
export const AlertOut = z.object({ headline: z.string(), detail: z.string() });

export const SmsOut = z.object({
  found: z.boolean(), brand: z.string().max(60).nullable(), legal_name: z.string().max(100).nullable(),
  amount_rupees: z.number().nonnegative().nullable(), interval: z.enum(["month", "quarter", "year"]).nullable(),
  next_due: z.string().nullable(), kind: z.enum(["subscription", "emi", "sip", "insurance", "bill"]),
});
export const SCHEMAS = { reminder: ReminderOut, tagger: TagOut, intake: IntakeOut, case_summary: CaseOut, lint: LintOut, alert: AlertOut, sms: SmsOut } as const;

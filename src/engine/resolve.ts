// src/engine/resolve.ts: deterministic mandate resolver for "Pakka se poochho" (PRD 14.5).
// The model only reads intent; this code picks the mandate.
import { tokens } from "./namegap";
import type { Session } from "./session";
import type { ReviewStamp } from "./types";

export interface Intake {
  intent: "explain_charge" | "refund_request" | "cancel_help" | "never_approved" | "failed_charge" | "other";
  merchant_text: string | null;
  amount_rupees: number | null;
  date_text: string | null;
  language: "hi" | "hinglish" | "en";
  modelVersion?: string;
  /** L3's reply, only when the review loop approved it. */
  reply?: string;
  review?: ReviewStamp;
}

export function resolveMandate(s: Session, userId: string, intake: Intake): { mandateId?: string; candidates: string[] } {
  const all = s.idx.mandatesByUser.get(userId) ?? [];
  let list = all;
  if (intake.merchant_text) {
    const q = new Set(tokens(intake.merchant_text));
    const byName = all.filter((m) => {
      const mer = s.idx.merchant.get(m.merchantId)!;
      return [...tokens(mer.brand), ...tokens(mer.legalName), mer.brand.toLowerCase()].some((t) => q.has(t) || intake.merchant_text!.toLowerCase().includes(t));
    });
    if (byName.length) list = byName;
  }
  if (intake.amount_rupees !== null) {
    const paise = intake.amount_rupees * 100;
    const byAmount = list.filter((m) => (s.idx.cyclesByMandate.get(m.id) ?? []).some((c) => c.amount === paise));
    if (byAmount.length) list = byAmount;
  }
  if (list.length === 1) return { mandateId: list[0].id, candidates: [list[0].id] };
  return { candidates: (list.length ? list : all).map((m) => m.id) };
}

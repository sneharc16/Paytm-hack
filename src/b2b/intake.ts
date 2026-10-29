// src/b2b/intake.ts: reading an invoice email. The email body is untrusted text from outside the company: it is
// scanned, never obeyed. Amounts, payee and invoice lines come only from the structured e-invoice and the
// vendor master; bank details found in an email can at most open a change request, which has its own checks.
import { z } from "zod";
import type { Invoice, Vendor } from "./types";

export const IntakeFlag = z.enum(["INJECTION", "BANK_CHANGE_IN_EMAIL", "URGENCY", "DISCOURAGES_CALLBACK", "SENDER_MISMATCH", "GSTIN_MISMATCH"]);
export type IntakeFlag = z.infer<typeof IntakeFlag>;

export const IntakeResult = z.object({
  invoiceId: z.string(),
  flags: z.array(IntakeFlag),
  evidence: z.array(z.string().max(160)),
  bankChange: z.object({ accountNo: z.string().regex(/^\d{9,18}$/), ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), holderClaimed: z.string().max(80).nullable() }).nullable(),
  /** How the reader got its answer. A model may add evidence later, but this parser is the floor. */
  reader: z.literal("rules-v1"),
});
export type IntakeResult = z.infer<typeof IntakeResult>;

const INJECTION = [
  /ignore (all |any |your )?(previous|prior|earlier) (instructions|rules|policy)/i,
  /note for the ai|ai assistant processing|to the (ai|assistant|agent)\b/i,
  /system prompt|developer message|you are now/i,
  /mark (the )?payment as (verified|approved)/i,
  /pre-?approved by/i,
  /(bypass|skip|override) (the )?(policy|approval|checks?)/i,
];
const BANK_CHANGE = [/(bank|account)( details)? (has |have )?(been )?changed/i, /new (bank )?account/i, /updated bank details/i, /change (of|in) bank/i];
const URGENCY = [/\burgent\b/i, /\btoday\b/i, /\bimmediately\b/i, /\basap\b/i];
const NO_CALL = [/(do not|don't|dont) call/i, /phones? (are|is) (down|not working)/i, /reply (on|to) this (mail|email) only/i];

const domain = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";
const firstMatch = (res: RegExp[], text: string) => {
  for (const r of res) { const m = text.match(r); if (m) return m[0]; }
  return null;
};

export function readInvoiceEmail(inv: Invoice, vendor: Vendor): IntakeResult {
  const text = `${inv.email.subject}\n${inv.email.body}`;
  const flags: IntakeFlag[] = [];
  const evidence: string[] = [];
  const hit = (flag: IntakeFlag, res: RegExp[]) => { const m = firstMatch(res, text); if (m) { flags.push(flag); evidence.push(`${flag}: "${m.slice(0, 120)}"`); } };
  hit("INJECTION", INJECTION);
  hit("BANK_CHANGE_IN_EMAIL", BANK_CHANGE);
  hit("URGENCY", URGENCY);
  hit("DISCOURAGES_CALLBACK", NO_CALL);
  if (domain(inv.email.from) !== domain(vendor.email)) { flags.push("SENDER_MISMATCH"); evidence.push(`SENDER_MISMATCH: mail from ${domain(inv.email.from)}, vendor master has ${domain(vendor.email)}`); }
  if (inv.gstin !== vendor.gstin) { flags.push("GSTIN_MISMATCH"); evidence.push(`GSTIN_MISMATCH: invoice ${inv.gstin}, vendor master ${vendor.gstin}`); }
  const acct = text.match(/(?:a\/c|account(?: no\.?| number)?)[\s:.-]*(\d{9,18})/i)?.[1] ?? null;
  const ifsc = text.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/)?.[1] ?? null;
  const holder = text.match(/name[\s:]+([A-Za-z][A-Za-z .&]{2,60}?)(?=[.,\n]|$)/i)?.[1]?.trim() ?? null;
  const bankChange = acct && ifsc ? { accountNo: acct, ifsc, holderClaimed: holder } : null;
  if (bankChange && !flags.includes("BANK_CHANGE_IN_EMAIL")) { flags.push("BANK_CHANGE_IN_EMAIL"); evidence.push("BANK_CHANGE_IN_EMAIL: account and IFSC in the mail body"); }
  return IntakeResult.parse({ invoiceId: inv.id, flags, evidence, bankChange, reader: "rules-v1" });
}

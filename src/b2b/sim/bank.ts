// src/b2b/sim/bank.ts: the company's bank, simulated. Pure: it reads the world and the bank's own book
// (passed in), never the clock. Only guard.ts and the status poller call payout and status.
import { sha256 } from "@/lib/hash";
import type { BankScript, BusinessWorld, ISO, Paise, Rail } from "../types";

export interface BankBookEntry { idemKey: string; amount: Paise; accountHash: string; rail: Rail; submittedAt: ISO; status: "success" | "pending" | "failed" | "unknown"; utr?: string; attempt: number }
export type BankBook = Map<string, BankBookEntry>;

const NOISE = new Set(["PVT", "LTD", "PRIVATE", "LIMITED", "LLP", "THE", "AND", "CO", "M/S", "MS"]);
const tokens = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !NOISE.has(t));

/** 0 to 100: share of the registered name's words found in the bank's account holder name. */
export function nameMatch(registered: string, holder: string): number {
  const a = tokens(registered), b = new Set(tokens(holder));
  if (!a.length) return 0;
  return Math.round((a.filter((t) => b.has(t)).length / a.length) * 100);
}

/** Penny drop: a ₹1 credit whose reply carries the account holder's name. */
export function pennyDrop(w: BusinessWorld, ifsc: string, accountNo: string): { found: boolean; holder: string | null } {
  const r = w.bankDirectory.find((x) => x.ifsc === ifsc.toUpperCase() && x.accountNo === accountNo);
  return r ? { found: true, holder: r.holder } : { found: false, holder: null };
}

export const utrFor = (idemKey: string) => `SBKP${sha256(`utr|${idemKey}`).slice(0, 12).toUpperCase()}`;

/**
 * Submit a payout. Idempotent on idemKey: a second submit with the same key never debits again, it returns
 * the first entry. That is the bank's half of "never pay twice"; the guard's consumed-nonce set is the other.
 */
export function submit(book: BankBook, idemKey: string, amount: Paise, accountHash: string, rail: Rail, at: ISO, script: BankScript | undefined, attempt: number): { entry: BankBookEntry; duplicate: boolean } {
  const prev = book.get(idemKey);
  if (prev) return { entry: prev, duplicate: true };
  const s = attempt === 1 ? script ?? "success" : "success";
  const status: BankBookEntry["status"] = s === "success" ? "success" : s === "pending_then_success" ? "pending" : s === "fail_technical" ? "failed" : "unknown";
  return { entry: { idemKey, amount, accountHash, rail, submittedAt: at, status, utr: status === "success" ? utrFor(idemKey) : undefined, attempt }, duplicate: false };
}

/** Status enquiry. Pending and timed-out payouts settle 10 minutes after submission. */
export function status(e: BankBookEntry, at: ISO): BankBookEntry["status"] {
  if (e.status === "pending" || e.status === "unknown") return new Date(at).getTime() - new Date(e.submittedAt).getTime() >= 10 * 60_000 ? "success" : "pending";
  return e.status;
}

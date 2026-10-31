// src/engine/live.ts: a real person's own world for Pakka live. They tell Pakka about their AutoPays (typed, or
// read from a bank SMS and confirmed by them); this turns that into the same World the engine runs for the demo,
// so every rule, the gateway and the screens work unchanged. Pure: time comes in as arguments.
// Only money is simulated: the charge itself goes to the NPCI simulator, which succeeds.
import { z } from "zod";
import { ist, IST_OFFSET_MIN, ms } from "./clock";
import { maxSkipsAllowed } from "./state";
import type { Cycle, ISO, Lang, Mandate, Merchant, MerchantCategory, Plan, User, World } from "./types";
import { sha256 } from "@/lib/hash";

export const AUTOPAY_KINDS = ["subscription", "emi", "sip", "insurance", "bill"] as const;
export type AutopayKind = (typeof AUTOPAY_KINDS)[number];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
/** What the person enters. Amounts are integer paise. */
export const AutopayInput = z.object({
  brand: z.string().trim().min(1).max(40),
  legalName: z.string().trim().max(80).default(""),
  kind: z.enum(AUTOPAY_KINDS),
  amount: z.number().int().min(100).max(10_00_000_00), // ₹1 to ₹10 lakh
  interval: z.enum(["month", "quarter", "year"]),
  nextDue: date,
  trial: z.object({ amount: z.number().int().min(0).max(100_000), startedOn: date }).nullable().default(null),
  source: z.enum(["typed", "sms"]).default("typed"),
});
export type AutopayInput = z.infer<typeof AutopayInput>;
export interface LiveAutopay extends AutopayInput { id: string; addedAt: ISO }

export interface LiveProfile { id: string; name: string; lang: Lang; startAt: ISO }

/** Charges run at 10 PM IST on the due day: off-peak, and after the 9:30 PM evening window the copy names. */
export const CHARGE_TIME_IST = "22:00";
/** How far ahead cycles exist. Later ones appear as time passes; their ids never change. */
export const HORIZON_DAYS = 62;

const CATEGORY: Record<AutopayKind, MerchantCategory> = { subscription: "video", emi: "loan", sip: "mutual_fund", insurance: "insurance", bill: "electricity" };
const TILES: [string, string][] = [["#FDEBDD", "#A4461A"], ["#E3F1E6", "#2E6B3A"], ["#FCE8EF", "#9A2C55"], ["#E4F4F8", "#17677A"], ["#EFE8F7", "#5B3A8C"], ["#E6EEF9", "#2D5C9E"], ["#FFF0DC", "#8A5300"], ["#E8ECEF", "#3D4A55"]];
const STEP: Record<LiveAutopay["interval"], number> = { month: 1, quarter: 3, year: 12 };

/** IST calendar date of an instant. */
export const istDate = (iso: ISO) => new Date(ms(iso) + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);

/** `day` plus n months, keeping the day of month where the month allows (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Refuse what cannot be scheduled: the first charge must still be ahead. */
export function checkAutopay(a: AutopayInput, now: ISO): string | null {
  if (ms(ist(`${a.nextDue} ${CHARGE_TIME_IST}`)) <= ms(now) + 5 * 60_000) return "NEXT_DUE_IN_PAST";
  if (ms(ist(`${a.nextDue} 00:00`)) - ms(now) > 400 * 86_400_000) return "NEXT_DUE_TOO_FAR";
  if (a.trial && a.trial.startedOn > a.nextDue) return "TRIAL_AFTER_DUE";
  if (a.trial && a.trial.amount >= a.amount) return "TRIAL_NOT_CHEAPER";
  return null;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** The World for one person, as of `until` (cycles due up to then exist). Deterministic in its inputs. */
export function buildLiveWorld(p: LiveProfile, autopays: LiveAutopay[], until: ISO): World {
  const user: User = { id: p.id, name: p.name, initials: initials(p.name), city: "", lang: p.lang };
  const merchants: Merchant[] = [], plans: Plan[] = [], mandates: Mandate[] = [], cycles: Cycle[] = [];
  for (const a of autopays) {
    const h = sha256(`${p.id}|${a.id}`);
    const category = CATEGORY[a.kind];
    const tile = TILES[parseInt(h.slice(0, 2), 16) % TILES.length];
    const merchantId = `mer_${a.id}`, planId = `plan_${a.id}`, mandateId = a.id;
    merchants.push({
      id: merchantId, brand: a.brand, legalName: a.legalName || a.brand,
      // Entered by the person, not checked with the merchant.
      brandVerified: false, category, knownObligation: a.kind !== "subscription", tile: { bg: tile[0], fg: tile[1] },
      // Not a Pakka partner: no Doosri Haan, no usage signal, no skip or downgrade offers, no auto refunds.
      settings: { askBeforeFirstCharge: false, shareUsageSignal: false, offerSkip: false, offerDowngradePlanId: null, refundAuto: false, refundWindowHours: 0, refundCap: 0, refundDailyLimit: 0, offerCopy: {} },
    });
    const trialDays = a.trial ? Math.max(1, Math.round((ms(ist(`${a.nextDue} 00:00`)) - ms(ist(`${a.trial.startedOn} 00:00`))) / 86_400_000)) : null;
    plans.push({ id: planId, merchantId, name: a.brand, amount: a.amount, interval: a.interval, trialAmount: a.trial ? a.trial.amount : null, trialDays });
    mandates.push({
      id: mandateId, umn: `UMN${h.slice(2, 14).toUpperCase()}`, userId: p.id, merchantId, planId,
      createdVia: "other_app", visibleViaInterop: false, irrevocable: a.kind === "emi",
      amountRule: "max", maxAmount: a.amount, validityEnd: ist(`${addMonths(a.nextDue, 120)} 23:59`),
      trialStartedAt: a.trial ? ist(`${a.trial.startedOn} 12:00`) : null, usageConsent: false,
      createdAuth: { method: "upi_pin", device: "other app", at: a.addedAt },
    });
    const minCycles = maxSkipsAllowed() + 1;
    for (let seq = 1; ; seq++) {
      const day = addMonths(a.nextDue, (seq - 1) * STEP[a.interval]);
      const dueAt = ist(`${day} ${CHARGE_TIME_IST}`);
      if (seq > minCycles && ms(dueAt) > ms(until)) break;
      // The bank's pre-debit notice comes a day ahead, but never before Pakka knew about the AutoPay.
      const notice = Math.max(ms(dueAt) - 24 * 3_600_000, ms(a.addedAt) + 60_000);
      cycles.push({
        id: `${mandateId}_c${seq}`, mandateId, seq, dueAt, noticeAt: new Date(notice).toISOString(), amount: a.amount,
        firstAfterTrial: seq === 1 && !!a.trial, confirmedInMerchantAppAt: null, group: "ordinary",
      });
    }
  }
  return {
    seed: `live:${p.id}`, live: { startAt: p.startAt }, users: [user], merchants, plans, mandates, cycles,
    history: [], usage: [], reviews: [], scripted: [],
    fixtures: { caseCodes: {}, callbackCodes: {}, actionIds: {}, retryOffsetMin: {} },
  };
}

export const horizonFrom = (now: ISO): ISO => new Date(ms(now) + HORIZON_DAYS * 86_400_000).toISOString();

// src/b2b/policy.ts: the company's payment policy, its hash, and the two questions the guard asks of it:
// "is this change a loosening?" and "which people must approve this payment?".
import { canonical, dhash } from "./crypto";
import type { Paise, Rail } from "./types";

export interface Policy {
  companyId: string;
  version: number;
  perTxnCap: Paise;
  dailyLimit: Paise;
  /** Total that agents alone (no person) may release in one IST day. Bounds the loss if every agent is compromised. */
  agentOnlyDailyCap: Paise;
  /** Below this (per vendor, last 24 hours together) the agent quorum is enough. */
  checkerFrom: Paise;
  /** From this (per vendor, last 24 hours together) the CFO signs too. */
  cfoFrom: Paise;
  firstPaymentCap: Paise;
  coolingHoursNew: number;
  coolingHoursChanged: number;
  sodLookbackDays: number;
  intentTtlMinutes: number;
  approvalTtlMinutes: number;
  maxPaymentsPerVendorPerDay: number;
  maxNewBeneficiariesPerDay: number;
  releaseStartMin: number;
  releaseEndMin: number;
  matchToleranceBps: number;
  rails: Record<Rail, { min: Paise; max: Paise | null }>;
  tdsBps: Record<"goods" | "logistics" | "services" | "rent", number>;
  allowedModels: string[];
  msmeDays: number;
}

export const policyHash = (p: Policy) => dhash("policy", canonical(p));

export function defaultPolicy(companyId: string, allowedModels: string[]): Policy {
  return {
    companyId, version: 1,
    perTxnCap: 10_00_000_00, dailyLimit: 30_00_000_00, agentOnlyDailyCap: 3_00_000_00,
    checkerFrom: 50_000_00, cfoFrom: 5_00_000_00, firstPaymentCap: 1_00_000_00,
    coolingHoursNew: 24, coolingHoursChanged: 72, sodLookbackDays: 30,
    intentTtlMinutes: 12 * 60, approvalTtlMinutes: 8 * 60,
    maxPaymentsPerVendorPerDay: 4, maxNewBeneficiariesPerDay: 2,
    releaseStartMin: 9 * 60, releaseEndMin: 19 * 60, matchToleranceBps: 100,
    rails: { IMPS: { min: 1_00, max: 5_00_000_00 }, NEFT: { min: 1_00, max: null }, RTGS: { min: 2_00_000_00, max: null } },
    tdsBps: { goods: 0, logistics: 200, services: 1000, rent: 1000 },
    allowedModels: [...allowedModels].sort(),
    msmeDays: 45,
  };
}

// Direction of each field: +1 means a bigger number allows more money to move (loosening), -1 the opposite.
const LOOSER_IF_HIGHER: Partial<Record<keyof Policy, 1 | -1>> = {
  perTxnCap: 1, dailyLimit: 1, agentOnlyDailyCap: 1, checkerFrom: 1, cfoFrom: 1, firstPaymentCap: 1,
  coolingHoursNew: -1, coolingHoursChanged: -1, sodLookbackDays: -1, intentTtlMinutes: 1, approvalTtlMinutes: 1,
  maxPaymentsPerVendorPerDay: 1, maxNewBeneficiariesPerDay: 1, matchToleranceBps: 1,
};

export interface PolicyDiff { field: string; from: unknown; to: unknown; looser: boolean }

/** Computed, never declared by the proposer: a change is a loosening if any single field loosens. */
export function diffPolicy(a: Policy, b: Policy): PolicyDiff[] {
  const out: PolicyDiff[] = [];
  for (const k of Object.keys(LOOSER_IF_HIGHER) as (keyof Policy)[]) {
    if (a[k] === b[k]) continue;
    const dir = LOOSER_IF_HIGHER[k]!;
    out.push({ field: k, from: a[k], to: b[k], looser: dir === 1 ? (b[k] as number) > (a[k] as number) : (b[k] as number) < (a[k] as number) });
  }
  // Anything else that changes (windows, rails, TDS, models) is treated as a loosening: it needs the timelock.
  for (const k of ["releaseStartMin", "releaseEndMin", "rails", "tdsBps", "allowedModels", "msmeDays", "companyId"] as const) {
    if (canonical(a[k]) !== canonical(b[k])) out.push({ field: k, from: a[k], to: b[k], looser: true });
  }
  return out;
}

export const isLoosening = (d: PolicyDiff[]) => d.some((x) => x.looser);
export const TIMELOCK_HOURS = 24;
export const GOVERNANCE_THRESHOLD = 2;

export type Tier = "agents" | "checker" | "checker_cfo";
export function tierFor(p: Policy, aggregate: Paise, forceChecker: boolean): Tier {
  if (aggregate >= p.cfoFrom) return "checker_cfo";
  if (aggregate >= p.checkerFrom || forceChecker) return "checker";
  return "agents";
}
export const rolesFor = (t: Tier): ("checker" | "cfo")[] => (t === "agents" ? [] : t === "checker" ? ["checker"] : ["checker", "cfo"]);

export function railFor(p: Policy, amount: Paise): Rail {
  if (amount >= p.rails.RTGS.min) return "RTGS";
  if (p.rails.IMPS.max !== null && amount <= p.rails.IMPS.max) return "IMPS";
  return "NEFT";
}

export const tdsOn = (p: Policy, category: keyof Policy["tdsBps"], taxable: Paise) => Math.floor((taxable * p.tdsBps[category]) / 10_000);

// src/engine/risk.ts: mandate-risk-v1 (PRD 11)
import type { ISO, Paise } from "./types";

export type FeatureId = "F1" | "F2" | "F3a" | "F3b" | "F3c" | "F3d" | "F4" | "F5" | "F6" | "F7";
export type Band = "ask" | "tell" | "list" | "remind_only";

export interface RiskScore {
  cycleId: string;
  model: "mandate-risk-v1";
  score: number;
  band: Band;
  contributions: { id: FeatureId; label: string; points: number }[];
  cappedBy?: "known_obligation" | "always_keep" | "confirmed";
  computedAt: ISO;
}

export const FEATURE_LABELS: Record<FeatureId, string> = {
  F1: "Trial jump", F2: "First real charge", F3a: "App not opened", F3b: "Usage unknown", F3c: "App opened",
  F3d: "Customer said they use it", F4: "Name gap", F5: "Open incident", F6: "Amount jump", F7: "Quick cancel history",
};

const POINTS: Record<FeatureId, number> = { F1: 30, F2: 15, F3a: 25, F3b: 8, F3c: -20, F3d: -30, F4: 10, F5: 10, F6: 5, F7: 5 };

export interface RiskInput {
  cycleId: string;
  at: ISO;
  amount: Paise;
  trialAmount: Paise | null;
  firstCharge: boolean; // first after trial, or first of the mandate
  usage: "not_opened" | "opened" | "unknown" | "customer_uses"; // already filtered by consent
  nameGap: boolean;
  openIncident: boolean;
  medianRecent: Paise | null; // median AutoPay charge in the last 90 days, null when none
  quickCancelHistory: boolean;
  irrevocable: boolean;
  knownObligation: boolean;
  alwaysKeep: boolean;
  confirmed: boolean;
}

export function bandFor(score: number): Band {
  if (score >= 60) return "ask";
  if (score >= 35) return "tell";
  return "list";
}

export function scoreCycle(i: RiskInput): RiskScore {
  const base = { cycleId: i.cycleId, model: "mandate-risk-v1" as const, computedAt: i.at };
  if (i.irrevocable) return { ...base, score: 0, band: "remind_only", contributions: [] };

  const c: RiskScore["contributions"] = [];
  const add = (id: FeatureId) => c.push({ id, label: FEATURE_LABELS[id], points: POINTS[id] });
  if (i.trialAmount !== null && i.trialAmount <= 1000 && i.amount >= 9900) add("F1");
  if (i.firstCharge) add("F2");
  add(i.usage === "not_opened" ? "F3a" : i.usage === "opened" ? "F3c" : i.usage === "customer_uses" ? "F3d" : "F3b");
  if (i.nameGap) add("F4");
  if (i.openIncident) add("F5");
  if (i.medianRecent !== null && i.amount > 2 * i.medianRecent) add("F6");
  if (i.quickCancelHistory) add("F7");

  let score = Math.max(0, Math.min(100, c.reduce((s, x) => s + x.points, 0)));
  let cappedBy: RiskScore["cappedBy"];
  if (i.alwaysKeep) { score = 0; cappedBy = "always_keep"; }
  else if (i.knownObligation && score > 30) { score = 30; cappedBy = "known_obligation"; }
  let band = bandFor(score);
  if (i.confirmed) { band = "list"; cappedBy = cappedBy ?? "confirmed"; }
  return { ...base, score, band, contributions: c, ...(cappedBy ? { cappedBy } : {}) };
}

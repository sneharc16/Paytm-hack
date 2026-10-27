// src/sim/bank.ts: issuer bank simulator (PRD 26.1). Pure; only the gateway calls it.
import { sha256 } from "@/lib/hash";
import type { EngineState } from "@/engine/state";
import type { Cycle } from "@/engine/types";

export function issueNotice(cycle: Cycle, legalName: string, umn: string) {
  return { cycleId: cycle.id, mandateId: cycle.mandateId, legalName, amount: cycle.amount, dueAt: cycle.dueAt, umn, reason: "Recurring payment" };
}

export function verifyPin(userId: string, digits: string, nonce: string): { pinToken: string } | { error: "WRONG_PIN" } {
  // In production this is NPCI's common library PIN screen and the app never sees the PIN.
  if (!/^(\d{4}|\d{6})$/.test(digits) || digits === "0000") return { error: "WRONG_PIN" };
  return { pinToken: `pin_${sha256(`${userId}|${nonce}`).slice(0, 16)}` };
}

export function optOut(s: EngineState, mandateId: string, pinToken: string | undefined): { ok: true } | { error: "PIN_REQUIRED" | "IRREVOCABLE" | "MANDATE_INACTIVE" } {
  const m = s.world.mandates.find((x) => x.id === mandateId);
  if (!m) return { error: "MANDATE_INACTIVE" };
  if (m.irrevocable) return { error: "IRREVOCABLE" };
  if (s.mandateStatus.get(mandateId) !== "active") return { error: "MANDATE_INACTIVE" };
  if (!pinToken || !s.pinTokens.has(pinToken)) return { error: "PIN_REQUIRED" };
  return { ok: true };
}

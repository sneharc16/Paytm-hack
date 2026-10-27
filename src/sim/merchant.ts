// src/sim/merchant.ts: merchant subscriptions simulator (PRD 26.2).
import { addMin, ms } from "@/engine/clock";
import type { EngineState } from "@/engine/state";
import type { Cycle, ISO } from "@/engine/types";

export type MerchantFailure = "TIMEOUT";
/** Failure injection for red-team runs: the next call of this kind times out. */
export const injected: { skipCycle?: MerchantFailure } = {};
export function failNext(kind: "skipCycle", f: MerchantFailure) { injected[kind] = f; }

export function skipCycle(s: EngineState, cycle: Cycle, at: ISO, viaOffer: boolean): { ok: true } | { error: "TOO_LATE" | "NOT_OFFERED" | "TIMEOUT" } {
  if (injected.skipCycle) { delete injected.skipCycle; return { error: "TIMEOUT" }; }
  const merchantId = s.world.mandates.find((m) => m.id === cycle.mandateId)!.merchantId;
  if (viaOffer && !s.merchantSettings.get(merchantId)!.offerSkip) return { error: "NOT_OFFERED" };
  if (ms(at) > ms(addMin(cycle.dueAt, -60))) return { error: "TOO_LATE" };
  return { ok: true };
}

export function queueRefund(at: ISO) {
  return { queuedUntil: addMin(at, 24 * 60) }; // merchant SLA 24h
}

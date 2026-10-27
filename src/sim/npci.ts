// src/sim/npci.ts: NPCI execution simulator (PRD 26.3).
import { isPeak, ms } from "@/engine/clock";
import type { ISO } from "@/engine/types";

export type ExecResult = "success" | "insufficient_funds" | "technical";

export function execute(attemptNo: number, at: ISO, scripted: ExecResult | undefined): { result: ExecResult } {
  if (isPeak(new Date(at))) throw new Error("NPCI: execution inside a peak window");
  if (attemptNo > 4) throw new Error("NPCI: more than one attempt plus three retries");
  return { result: scripted ?? "success" };
}

/** Status checks: not before 90 seconds after the attempt, at most 3 per 2 hours. */
export function canCheckStatus(attemptAt: ISO, at: ISO, checksInLast2h: number): boolean {
  return ms(at) - ms(attemptAt) >= 90_000 && checksInLast2h < 3;
}

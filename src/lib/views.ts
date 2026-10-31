// View selectors: turn replayed state into what each screen shows. Pure functions of the session.
import type { Session } from "@/engine/session";
import type { CycleState } from "@/engine/state";
import type { Cycle, Lang, Mandate, Merchant, Persona, Plan, User } from "@/engine/types";
import { ms } from "@/engine/clock";

export const PERSONAS: { id: Persona; userId: string; label: string }[] = [
  { id: "sunita", userId: "u_sunita", label: "Sunita" },
  { id: "rahul", userId: "u_rahul", label: "Rahul" },
  { id: "farhan", userId: "u_farhan", label: "Farhan" },
  { id: "anjali", userId: "u_anjali", label: "Anjali" },
];

export interface Row { mandate: Mandate; merchant: Merchant; plan: Plan; cycle: Cycle; cs: CycleState; user: User }

/** The cycle a list row is about: the in-window cycle if there is one, else the latest. */
export function currentCycle(s: Session, mandateId: string): Cycle {
  const cycles = s.idx.cyclesByMandate.get(mandateId) ?? [];
  // A live world holds the next few charges ahead: the current one is the first not yet settled.
  if (s.world.live) {
    const active = s.state.mandateStatus.get(mandateId) === "active";
    return [...cycles].sort((a, b) => a.seq - b.seq).find((c) => {
      const st = s.state.cycle(c.id).status;
      return active ? !["succeeded", "skipped", "opted_out"].includes(st) : !["succeeded", "skipped"].includes(st);
    }) ?? cycles[cycles.length - 1];
  }
  return cycles.reduce((a, b) => (b.seq > a.seq ? b : a), cycles[0]);
}

export function rowsFor(s: Session, userId: string): Row[] {
  const user = s.idx.user.get(userId)!;
  return (s.idx.mandatesByUser.get(userId) ?? []).map((m) => {
    const cycle = currentCycle(s, m.id);
    return { mandate: m, merchant: s.idx.merchant.get(m.merchantId)!, plan: s.idx.plan.get(m.planId)!, cycle, cs: s.state.cycle(cycle.id), user };
  });
}

export const needsAnswer = (r: Row) => r.cs.status === "awaiting_answer" && !r.cs.decision && (r.cs.band === "ask" || !!r.cs.askRule);
export const isCollect = (r: Row) => r.cycle.group === "collect" && ["ready", "notice_received", "failed_business", "retry_scheduled"].includes(r.cs.status);

export type PillKind = "answer" | "neutral" | "done" | "muted" | "fraud";
export function pillFor(r: Row): { kind: PillKind; key: string } | null {
  const st = r.cs.status;
  if (needsAnswer(r)) return { kind: "answer", key: "pill.answer" };
  if (r.cycle.group === "collect" && (st === "ready" || st === "notice_received")) return { kind: "neutral", key: "pill.balance" };
  if (st === "retry_scheduled") return { kind: "neutral", key: "pill.scheduled" };
  if (st === "failed_business") return { kind: "answer", key: "pill.failed" };
  if (st === "skipped") return { kind: "muted", key: "pill.skipped" };
  if (st === "opted_out") return { kind: "muted", key: r.cs.optOutKind === "pause" ? "pill.skipped" : "pill.cancelled" };
  if (st === "succeeded") return { kind: "done", key: "pill.charged" };
  if (st === "confirmed") return { kind: "neutral", key: "pill.scheduled" };
  return null;
}

export function sectionOf(r: Row, now: string): "soon" | "this" | "next" | "interop" {
  if (r.mandate.visibleViaInterop) return "interop";
  const d = ms(r.cycle.dueAt) - ms(now);
  if (d < 2 * 86_400_000) return "soon";
  if (d < 30 * 86_400_000) return "this";
  return "next";
}

export const langOf = (s: Session, userId: string): Lang => s.idx.user.get(userId)!.lang;

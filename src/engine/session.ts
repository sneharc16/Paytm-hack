// src/engine/session.ts: a world, an event log and the state replayed from it.
import { SESSION_START } from "./clock";
import { EngineState } from "./state";
import type { Cycle, Mandate, Merchant, NewEvent, PakkaEvent, PastExecution, Plan, ScriptedOutcome, UsageSignal, User, World } from "./types";

export interface WorldIndex {
  cycle: Map<string, Cycle>;
  mandate: Map<string, Mandate>;
  user: Map<string, User>;
  merchant: Map<string, Merchant>;
  plan: Map<string, Plan>;
  scripted: Map<string, ScriptedOutcome>;
  usage: Map<string, UsageSignal>;
  cyclesByMandate: Map<string, Cycle[]>;
  mandatesByUser: Map<string, Mandate[]>;
  historyByMandate: Map<string, PastExecution[]>;
}

const cache = new WeakMap<World, WorldIndex>();

export function indexWorld(w: World): WorldIndex {
  const hit = cache.get(w);
  if (hit) return hit;
  const group = <T, K>(xs: T[], key: (x: T) => K) => {
    const m = new Map<K, T[]>();
    for (const x of xs) { const k = key(x); const l = m.get(k); if (l) l.push(x); else m.set(k, [x]); }
    return m;
  };
  const idx: WorldIndex = {
    cycle: new Map(w.cycles.map((c) => [c.id, c])),
    mandate: new Map(w.mandates.map((m) => [m.id, m])),
    user: new Map(w.users.map((u) => [u.id, u])),
    merchant: new Map(w.merchants.map((m) => [m.id, m])),
    plan: new Map(w.plans.map((p) => [p.id, p])),
    scripted: new Map(w.scripted.map((s) => [s.cycleId, s])),
    usage: new Map(w.usage.map((u) => [u.mandateId, u])),
    cyclesByMandate: group(w.cycles, (c) => c.mandateId),
    mandatesByUser: group(w.mandates, (m) => m.userId),
    historyByMandate: group(w.history, (h) => h.mandateId),
  };
  cache.set(w, idx);
  return idx;
}

export type Listener = (events: PakkaEvent[]) => void;

export class Session {
  events: PakkaEvent[] = [];
  state: EngineState;
  idx: WorldIndex;
  processedTo: string;
  private pending: PakkaEvent[] = [];

  constructor(public id: string, public world: World, events: PakkaEvent[] = []) {
    this.idx = indexWorld(world);
    this.state = new EngineState(world, SESSION_START);
    this.processedTo = SESSION_START;
    if (events.length) ingest(this, events);
  }

  get nextId() { return (this.events.at(-1)?.id ?? 0) + 1; }

  emit(e: NewEvent): PakkaEvent {
    const full: PakkaEvent = { id: this.nextId, sessionId: this.id, ...e };
    this.events.push(full);
    this.state.apply(full);
    this.pending.push(full);
    return full;
  }

  /** Events emitted since the last drain, for sync. */
  drain(): PakkaEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  mandateOf(cycleId: string) { return this.idx.mandate.get(this.idx.cycle.get(cycleId)!.mandateId)!; }
  merchantOf(mandateId: string) { return this.idx.merchant.get(this.idx.mandate.get(mandateId)!.merchantId)!; }
  userOf(mandateId: string) { return this.idx.user.get(this.idx.mandate.get(mandateId)!.userId)!; }
  settings(merchantId: string) { return this.state.merchantSettings.get(merchantId)!; }
}

/** Apply events that arrived from elsewhere (the server) to a local replica. */
export function ingest(s: Session, events: PakkaEvent[]) {
  let added = 0;
  for (const e of events) {
    if (e.id <= (s.events.at(-1)?.id ?? 0)) continue;
    s.events.push(e);
    s.state.apply(e);
    added++;
  }
  // Some events are stamped a few seconds after the job that made them (a merchant replies 3 s later), so the
  // latest timestamp can be ahead of what was actually processed. Re-run the last few seconds: every handler
  // is safe to run twice.
  if (added) {
    const resume = new Date(new Date(s.state.cursor).getTime() - REPLAY_OVERLAP_MS).toISOString();
    if (resume > s.processedTo) s.processedTo = resume;
  }
}

/** Larger than the biggest offset any handler adds to an event's timestamp (5 s). */
export const REPLAY_OVERLAP_MS = 10_000;

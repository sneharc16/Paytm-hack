// Where shared sessions live on the server. Supabase when its keys are set (works on Vercel, where each
// request may land on a different server); otherwise this process's memory (one laptop, no setup).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ClockState } from "@/engine/clock";
import type { PakkaEvent } from "@/engine/types";

export class ConflictError extends Error {}

export interface SessionRow { id: string; seed: string; clock: ClockState; epoch: number }

export interface Store {
  kind: "memory" | "supabase";
  /** The session row, created with `clock` if it doesn't exist yet. */
  load(id: string, clock: ClockState): Promise<SessionRow>;
  eventsAfter(id: string, epoch: number, seq: number): Promise<PakkaEvent[]>;
  /** Append events numbered after `afterSeq`. Throws ConflictError if someone else appended first. */
  append(id: string, epoch: number, afterSeq: number, events: PakkaEvent[]): Promise<void>;
  saveClock(id: string, epoch: number, clock: ClockState): Promise<void>;
  /** New epoch with no events. Returns the new epoch. */
  restart(id: string, clock: ClockState): Promise<number>;
}

// ---------- memory ----------
class MemoryStore implements Store {
  kind = "memory" as const;
  rows = new Map<string, SessionRow>();
  log = new Map<string, PakkaEvent[]>();
  async load(id: string, clock: ClockState) {
    let r = this.rows.get(id);
    if (!r) { r = { id, seed: "2711", clock, epoch: 1 }; this.rows.set(id, r); this.log.set(id, []); }
    return structuredClone(r);
  }
  async eventsAfter(id: string, epoch: number, seq: number) {
    const r = this.rows.get(id);
    return r && r.epoch === epoch ? (this.log.get(id) ?? []).filter((e) => e.id > seq) : [];
  }
  async append(id: string, epoch: number, afterSeq: number, events: PakkaEvent[]) {
    const r = this.rows.get(id)!;
    const log = this.log.get(id)!;
    if (r.epoch !== epoch || (log.at(-1)?.id ?? 0) !== afterSeq) throw new ConflictError("SEQ_CONFLICT");
    log.push(...events);
  }
  async saveClock(id: string, epoch: number, clock: ClockState) {
    const r = this.rows.get(id)!;
    if (r.epoch === epoch) r.clock = clock;
  }
  async restart(id: string, clock: ClockState) {
    const r = this.rows.get(id)!;
    r.epoch++; r.clock = clock;
    this.log.set(id, []);
    return r.epoch;
  }
}

// ---------- Supabase ----------
const CHUNK = 1500; // events per append call
const PAGE = 1000; // PostgREST's default row limit

type Row = {
  seq: number; sim_at: string; type: string; actor: PakkaEvent["actor"]; subject_type: string | null; subject_id: string | null;
  rule_id: string | null; model_version: string | null; idempotency_key: string | null; payload: Record<string, unknown>;
};

class SupabaseStore implements Store {
  kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  async load(id: string, clock: ClockState): Promise<SessionRow> {
    const got = await this.db.from("sessions").select("id, seed, clock, epoch").eq("id", id).maybeSingle();
    if (got.error) throw new Error(got.error.message);
    if (got.data) return got.data as SessionRow;
    const made = await this.db.from("sessions").upsert({ id, seed: "2711", clock, epoch: 1 }, { onConflict: "id", ignoreDuplicates: true }).select("id, seed, clock, epoch").maybeSingle();
    if (made.error) throw new Error(made.error.message);
    return (made.data as SessionRow | null) ?? this.load(id, clock);
  }

  async eventsAfter(id: string, epoch: number, seq: number): Promise<PakkaEvent[]> {
    const out: PakkaEvent[] = [];
    for (let from = seq; ; ) {
      const r = await this.db.from("events")
        .select("seq, sim_at, type, actor, subject_type, subject_id, rule_id, model_version, idempotency_key, payload")
        .eq("session_id", id).eq("epoch", epoch).gt("seq", from).order("seq").limit(PAGE);
      if (r.error) throw new Error(r.error.message);
      const rows = r.data as Row[];
      for (const x of rows) {
        out.push({
          id: x.seq, sessionId: id, simAt: new Date(x.sim_at).toISOString(), type: x.type as PakkaEvent["type"], actor: x.actor,
          ...(x.subject_type ? { subjectType: x.subject_type as PakkaEvent["subjectType"] } : {}),
          ...(x.subject_id ? { subjectId: x.subject_id } : {}),
          ...(x.rule_id ? { ruleId: x.rule_id } : {}),
          ...(x.model_version ? { modelVersion: x.model_version } : {}),
          ...(x.idempotency_key ? { idempotencyKey: x.idempotency_key } : {}),
          payload: x.payload,
        });
      }
      if (rows.length < PAGE) return out;
      from = rows.at(-1)!.seq;
    }
  }

  async append(id: string, epoch: number, afterSeq: number, events: PakkaEvent[]) {
    // Each chunk is atomic and checks the sequence, so a crash midway leaves a valid prefix that the next
    // request completes: replaying the prefix and ticking again regenerates the rest.
    let after = afterSeq;
    for (let i = 0; i < events.length; i += CHUNK) {
      const chunk = events.slice(i, i + CHUNK);
      const r = await this.db.rpc("append_events", { p_session: id, p_epoch: epoch, p_after: after, p_events: chunk });
      if (r.error) {
        if (/SEQ_CONFLICT|EPOCH_CHANGED/.test(r.error.message)) throw new ConflictError(r.error.message);
        throw new Error(r.error.message);
      }
      after = chunk.at(-1)!.id;
    }
  }

  async saveClock(id: string, epoch: number, clock: ClockState) {
    const r = await this.db.from("sessions").update({ clock }).eq("id", id).eq("epoch", epoch);
    if (r.error) throw new Error(r.error.message);
  }

  async restart(id: string, clock: ClockState) {
    const r = await this.db.rpc("restart_session", { p_session: id, p_clock: clock });
    if (r.error) throw new Error(r.error.message);
    return r.data as number;
  }
}

const g = globalThis as unknown as { __pakkaStore?: Store };

export function getStore(): Store {
  if (g.__pakkaStore) return g.__pakkaStore;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  g.__pakkaStore = url && key
    ? new SupabaseStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }))
    : new MemoryStore();
  return g.__pakkaStore;
}

/** Tests swap in a fresh memory store. */
export function setStoreForTests(s: Store | undefined) { g.__pakkaStore = s; }
export const memoryStore = () => new MemoryStore();

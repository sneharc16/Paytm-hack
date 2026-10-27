// Shared demo sessions on the server. The store (Supabase, or memory) holds the log and the clock; each
// server instance keeps a replica of the session, catches up from the store, advances it to the sim clock,
// and appends what it produced. If another instance appended first, it re-reads and retries; the engine is
// deterministic, so the retry produces the same events.
import { tick } from "@/engine/agent";
import { DEMO_END, ms, SESSION_START, simNow, type ClockState } from "@/engine/clock";
import { applyCommand, type ClockCommand, type Command } from "@/engine/commands";
import { checkInvariants } from "@/engine/invariants";
import { ingest, Session } from "@/engine/session";
import type { World } from "@/engine/types";
import { generateWorld } from "@/engine/world";
import { installModelHooks } from "@/llm/hooks";
import { ConflictError, getStore } from "./store";

installModelHooks();

interface Entry { session: Session; clock: ClockState; epoch: number; invariantFailures: string[] }

const g = globalThis as unknown as { __pakka?: { worlds: Map<string, World>; replicas: Map<string, Entry>; n: number } };
const mem = (g.__pakka ??= { worlds: new Map(), replicas: new Map(), n: 6 });

function world(seed: string) {
  let w = mem.worlds.get(seed);
  if (!w) { w = generateWorld(seed); mem.worlds.set(seed, w); }
  return w;
}

const startClock = (): ClockState => ({ simAnchor: SESSION_START, realAnchor: Date.now(), speed: 60, paused: true });

export function newSessionId() {
  return `DEMO-${10 + Math.floor(Math.random() * 90)}`;
}

/** Bring this instance's replica in line with the store. */
async function sync(id: string): Promise<Entry> {
  const store = getStore();
  const row = await store.load(id, startClock());
  let e = mem.replicas.get(id);
  if (!e || e.epoch !== row.epoch) {
    e = { session: new Session(id, world(row.seed)), clock: row.clock, epoch: row.epoch, invariantFailures: [] };
    mem.replicas.set(id, e);
  }
  e.clock = row.clock;
  const last = e.session.events.at(-1)?.id ?? 0;
  ingest(e.session, await store.eventsAfter(id, e.epoch, last));
  e.session.drain();
  return e;
}

/** Persist what this instance just produced. */
async function flush(e: Entry, id: string, before: number) {
  const fresh = e.session.events.slice(before);
  e.session.drain();
  if (fresh.length) await getStore().append(id, e.epoch, fresh[0].id - 1, fresh);
}

/** Advance to the sim clock (the story pauses itself at 29 Oct, 6:00 AM) and persist. */
async function advance(e: Entry, id: string): Promise<string> {
  let now = simNow(e.clock, Date.now());
  if (ms(now.toISOString()) >= ms(DEMO_END) && !e.clock.paused) {
    e.clock = { ...e.clock, simAnchor: DEMO_END, realAnchor: Date.now(), paused: true };
    await getStore().saveClock(id, e.epoch, e.clock);
    now = new Date(DEMO_END);
  }
  const before = e.session.events.length;
  tick(e.session, now.toISOString());
  if (e.session.events.length !== before && !e.invariantFailures.length) {
    const fails = checkInvariants(e.session);
    if (fails.length) {
      e.invariantFailures = fails;
      e.clock = { ...e.clock, simAnchor: now.toISOString(), realAnchor: Date.now(), paused: true };
      await getStore().saveClock(id, e.epoch, e.clock);
    }
  }
  await flush(e, id, before);
  return now.toISOString();
}

/** Run `fn` on a synced, advanced replica; on a write conflict, drop the replica and try again. */
async function withSession<T>(id: string, fn: (e: Entry, now: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const e = await sync(id);
      const now = await advance(e, id);
      return await fn(e, now);
    } catch (err) {
      if (!(err instanceof ConflictError) || attempt >= 3) throw err;
      mem.replicas.delete(id);
    }
  }
}

export async function getSession(id: string) {
  return withSession(id, async (e) => ({ id, seed: e.session.world.seed, clock: e.clock, epoch: e.epoch }));
}

export async function eventsSince(id: string, after: number, epoch: number) {
  return withSession(id, async (e) => {
    const from = epoch === e.epoch ? after : 0;
    return { epoch: e.epoch, clock: e.clock, events: e.session.events.filter((x) => x.id > from), invariantFailures: e.invariantFailures };
  });
}

export async function command(id: string, c: Command) {
  return withSession(id, async (e, now) => {
    const before = e.session.events.length;
    const result = applyCommand(e.session, now, c);
    await flush(e, id, before);
    return result;
  });
}

export async function clockCommand(id: string, c: ClockCommand) {
  const store = getStore();
  return withSession(id, async (e, now) => {
    const real = Date.now();
    let clock = e.clock;
    switch (c.action) {
      case "play": clock = { ...clock, simAnchor: now, realAnchor: real, paused: false }; break;
      case "pause": clock = { ...clock, simAnchor: now, realAnchor: real, paused: true }; break;
      case "speed": clock = { ...clock, simAnchor: now, realAnchor: real, speed: (Number(c.value) as ClockState["speed"]) || 60 }; break;
      case "jump": {
        const to = String(c.value);
        if (ms(to) < ms(now)) {
          // Going back means replaying from the start.
          e.epoch = await store.restart(id, { ...clock, simAnchor: to, realAnchor: real });
          e.session = new Session(id, e.session.world);
          e.invariantFailures = [];
        }
        clock = { ...clock, simAnchor: to, realAnchor: real };
        break;
      }
      case "restart":
        e.epoch = await store.restart(id, startClock());
        e.session = new Session(id, e.session.world);
        e.invariantFailures = [];
        e.clock = startClock();
        return e.clock;
    }
    e.clock = clock;
    await store.saveClock(id, e.epoch, clock);
    await advance(e, id);
    return e.clock;
  });
}

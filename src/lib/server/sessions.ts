// In-memory demo sessions on the Node server. One process holds the log; every surface (laptop tabs and
// a phone on the same network) polls it. See docs/DECISIONS.md for why this stands in for Supabase.
import { tick } from "@/engine/agent";
import { DEMO_END, ms, SESSION_START, simNow, type ClockState } from "@/engine/clock";
import { applyCommand, type ClockCommand, type Command } from "@/engine/commands";
import { checkInvariants } from "@/engine/invariants";
import { Session } from "@/engine/session";
import { generateWorld } from "@/engine/world";
import type { World } from "@/engine/types";
import { installModelHooks } from "@/llm/hooks";

installModelHooks();

interface Entry { session: Session; clock: ClockState; epoch: number; invariantFailures: string[] }

const g = globalThis as unknown as { __pakka?: { worlds: Map<string, World>; sessions: Map<string, Entry>; n: number } };
const store = (g.__pakka ??= { worlds: new Map(), sessions: new Map(), n: 6 });

function world(seed: string) {
  let w = store.worlds.get(seed);
  if (!w) { w = generateWorld(seed); store.worlds.set(seed, w); }
  return w;
}

const startClock = (): ClockState => ({ simAnchor: SESSION_START, realAnchor: Date.now(), speed: 60, paused: true });

export function createSession(seed = "2711"): string {
  const id = `DEMO-${++store.n}`;
  store.sessions.set(id, { session: new Session(id, world(seed)), clock: startClock(), epoch: 1, invariantFailures: [] });
  return id;
}

export function getEntry(id: string): Entry {
  let e = store.sessions.get(id);
  if (!e) {
    // Any readable code joins a fresh session, so a phone can open DEMO-7 before the laptop creates it.
    e = { session: new Session(id, world("2711")), clock: startClock(), epoch: 1, invariantFailures: [] };
    store.sessions.set(id, e);
  }
  return e;
}

/** Bring the session up to the sim clock. The story pauses itself at 29 Oct, 6:00 AM. */
export function advance(e: Entry) {
  let now = simNow(e.clock, Date.now());
  if (ms(now.toISOString()) >= ms(DEMO_END) && !e.clock.paused) {
    e.clock = { ...e.clock, simAnchor: DEMO_END, realAnchor: Date.now(), paused: true };
    now = new Date(DEMO_END);
  }
  const before = e.session.events.length;
  tick(e.session, now.toISOString());
  if (e.session.events.length !== before) {
    const fails = checkInvariants(e.session);
    if (fails.length && !e.invariantFailures.length) {
      e.invariantFailures = fails;
      e.clock = { ...e.clock, simAnchor: now.toISOString(), realAnchor: Date.now(), paused: true };
    }
  }
  return now.toISOString();
}

export function command(id: string, c: Command) {
  const e = getEntry(id);
  const at = advance(e);
  const result = applyCommand(e.session, at, c);
  e.session.drain();
  return result;
}

export function clockCommand(id: string, c: ClockCommand) {
  const e = getEntry(id);
  const now = advance(e);
  const real = Date.now();
  switch (c.action) {
    case "play": e.clock = { ...e.clock, simAnchor: now, realAnchor: real, paused: false }; break;
    case "pause": e.clock = { ...e.clock, simAnchor: now, realAnchor: real, paused: true }; break;
    case "speed": e.clock = { ...e.clock, simAnchor: now, realAnchor: real, speed: (Number(c.value) as ClockState["speed"]) || 60 }; break;
    case "jump": {
      const to = String(c.value);
      if (ms(to) < ms(now)) {
        // Going back means replaying from the start.
        e.session = new Session(id, e.session.world);
        e.epoch++;
        e.invariantFailures = [];
      }
      e.clock = { ...e.clock, simAnchor: to, realAnchor: real };
      advance(e);
      break;
    }
    case "restart":
      e.session = new Session(id, e.session.world);
      e.clock = startClock();
      e.epoch++;
      e.invariantFailures = [];
      break;
  }
  e.session.drain();
  return e.clock;
}

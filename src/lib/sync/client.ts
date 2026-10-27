"use client";
// Client sync. Two modes behind one store:
// - "local" (default, works on any static or serverless host): the engine runs in the browser. The demo is
//   (clock, list of commands at sim times), saved in localStorage, so every tab in this browser replays the
//   same deterministic session.
// - "server" (NEXT_PUBLIC_SYNC=server, for a laptop plus phones on one network): the Node server holds the log
//   and every surface polls it.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { tick } from "@/engine/agent";
import { DEMO_END, ms, SESSION_START, simNow, type ClockState } from "@/engine/clock";
import { applyCommand, type ClockCommand, type Command } from "@/engine/commands";
import { checkInvariants } from "@/engine/invariants";
import { ingest, Session } from "@/engine/session";
import type { ISO, PakkaEvent, World } from "@/engine/types";
import { generateWorld } from "@/engine/world";
import { installModelHooks } from "@/llm/hooks";

installModelHooks();

export const SYNC_MODE: "local" | "server" = process.env.NEXT_PUBLIC_SYNC === "server" ? "server" : "local";

let worldCache: World | null = null;
const world = () => (worldCache ??= generateWorld("2711"));

interface SyncState {
  id: string;
  session: Session | null;
  epoch: number;
  clock: ClockState;
  version: number;
  failures: string[];
  connected: boolean;
  start: (id: string) => void;
  send: (c: Command) => Promise<unknown>;
  clockCmd: (c: ClockCommand) => Promise<void>;
  poll: () => Promise<void>;
}

const startClock = (): ClockState => ({ simAnchor: SESSION_START, realAnchor: Date.now(), speed: 60, paused: true });

// ---------- local mode ----------
interface LocalDoc { epoch: number; clock: ClockState; commands: { at: ISO; cmd: Command }[] }
const key = (id: string) => `pakka-local-${id}`;
function loadDoc(id: string): LocalDoc {
  try {
    const raw = localStorage.getItem(key(id));
    if (raw) return JSON.parse(raw);
  } catch { /* storage blocked: the demo still runs in this tab */ }
  return { epoch: 1, clock: startClock(), commands: [] };
}
function saveDoc(id: string, d: LocalDoc) {
  try { localStorage.setItem(key(id), JSON.stringify(d)); } catch { /* storage blocked */ }
}
let doc: LocalDoc | null = null;

function rebuild(id: string, d: LocalDoc): Session {
  const s = new Session(id, world());
  for (const c of d.commands) { tick(s, c.at); applyCommand(s, c.at, c.cmd); }
  s.drain();
  return s;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;

export const useSync = create<SyncState>((set, get) => {
  /** Local: bring the session up to the shared clock. */
  const advanceLocal = () => {
    const { id, session } = get();
    if (!session || !doc) return;
    let now = simNow(doc.clock, Date.now()).toISOString();
    if (!doc.clock.paused && ms(now) >= ms(DEMO_END)) {
      doc = { ...doc, clock: { ...doc.clock, simAnchor: DEMO_END, realAnchor: Date.now(), paused: true } };
      saveDoc(id, doc);
      now = DEMO_END;
    }
    const before = session.events.length;
    tick(session, now);
    session.drain();
    const changed = session.events.length !== before;
    set({
      clock: doc.clock, connected: true,
      ...(changed ? { version: get().version + 1, failures: get().failures.length ? get().failures : checkInvariants(session) } : {}),
    });
  };

  /** Local: another tab changed the shared doc. */
  const syncFromStorage = () => {
    const { id, session } = get();
    if (!session || !doc) return;
    const next = loadDoc(id);
    let s = session;
    if (next.epoch !== doc.epoch || next.commands.length < doc.commands.length) s = rebuild(id, next);
    else {
      for (const c of next.commands.slice(doc.commands.length)) {
        if (ms(c.at) < ms(s.processedTo)) { s = rebuild(id, next); break; }
        tick(s, c.at); applyCommand(s, c.at, c.cmd); s.drain();
      }
    }
    doc = next;
    set({ session: s, epoch: next.epoch, clock: next.clock, version: get().version + 1, failures: [] });
    advanceLocal();
  };

  return {
    id: "",
    session: null,
    epoch: 0,
    clock: { simAnchor: SESSION_START, realAnchor: 0, speed: 60, paused: true },
    version: 0,
    failures: [],
    connected: false,
    start(id) {
      if (get().id === id && get().session) return;
      if (timer) clearTimeout(timer);
      if (SYNC_MODE === "local") {
        doc = loadDoc(id);
        set({ id, session: rebuild(id, doc), epoch: doc.epoch, clock: doc.clock, version: 0 });
        window.addEventListener("storage", (e) => { if (e.key === key(id)) syncFromStorage(); });
      } else {
        set({ id, session: new Session(id, world()), epoch: 0, version: 0 });
      }
      const loop = async () => {
        await get().poll();
        timer = setTimeout(loop, get().clock.paused ? 1000 : 500);
      };
      void loop();
    },
    async poll() {
      if (SYNC_MODE === "local") { advanceLocal(); return; }
      const { id, session, epoch } = get();
      if (!id || !session || inflight) return;
      inflight = true;
      try {
        const last = session.events.at(-1)?.id ?? 0;
        const res = await fetch(`/api/sessions/${id}/events?after=${last}&epoch=${epoch}`, { cache: "no-store" });
        const body = (await res.json()) as { ok: boolean; data: { epoch: number; clock: ClockState; events: PakkaEvent[]; invariantFailures: string[] } };
        if (!body.ok) return;
        const d = body.data;
        let s = session;
        if (d.epoch !== epoch) s = new Session(id, world());
        ingest(s, d.events);
        // The server's clock anchors to its own wall time; re-anchor to ours so local display stays smooth.
        const clock = { ...d.clock, simAnchor: simNow(d.clock, Date.now()).toISOString(), realAnchor: Date.now() };
        set({ session: s, epoch: d.epoch, clock, failures: d.invariantFailures, connected: true, version: get().version + (d.events.length || d.epoch !== epoch ? 1 : 0) });
      } catch {
        set({ connected: false });
      } finally {
        inflight = false;
      }
    },
    async send(c) {
      if (SYNC_MODE === "local") {
        const { id, session } = get();
        if (!session || !doc) return null;
        advanceLocal();
        const at = session.processedTo > doc.clock.simAnchor ? session.processedTo : simNow(doc.clock, Date.now()).toISOString();
        tick(session, at);
        const result = applyCommand(session, at, c);
        session.drain();
        doc = { ...doc, commands: [...doc.commands, { at, cmd: c }] };
        saveDoc(id, doc);
        set({ version: get().version + 1 });
        return result ?? null;
      }
      const res = await fetch(`/api/sessions/${get().id}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
      const body = await res.json();
      await get().poll();
      return body.data;
    },
    async clockCmd(c) {
      if (SYNC_MODE === "local") {
        const { id, session } = get();
        if (!session || !doc) return;
        advanceLocal();
        const now = session.processedTo;
        const real = Date.now();
        let d = doc;
        switch (c.action) {
          case "play": d = { ...d, clock: { ...d.clock, simAnchor: now, realAnchor: real, paused: false } }; break;
          case "pause": d = { ...d, clock: { ...d.clock, simAnchor: now, realAnchor: real, paused: true } }; break;
          case "speed": d = { ...d, clock: { ...d.clock, simAnchor: now, realAnchor: real, speed: (Number(c.value) as ClockState["speed"]) || 60 } }; break;
          case "jump": {
            const to = String(c.value);
            if (ms(to) < ms(now)) d = { ...d, epoch: d.epoch + 1, commands: [] }; // going back replays from the start
            d = { ...d, clock: { ...d.clock, simAnchor: to, realAnchor: real } };
            break;
          }
          case "restart": d = { epoch: d.epoch + 1, clock: startClock(), commands: [] }; break;
        }
        const reset = d.epoch !== doc.epoch;
        doc = d;
        saveDoc(id, d);
        set({ ...(reset ? { session: rebuild(id, d), epoch: d.epoch, failures: [] } : {}), clock: d.clock, version: get().version + 1 });
        // Let the browser paint before a long jump runs the engine.
        await new Promise((r) => setTimeout(r, 0));
        advanceLocal();
        return;
      }
      await fetch(`/api/sessions/${get().id}/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
      await get().poll();
    },
  };
});

/** Current sim time on this device. */
export function useSimNow(): string {
  const clock = useSync((s) => s.clock);
  const [now, setNow] = useState(clock.simAnchor);
  useEffect(() => {
    const update = () => setNow(simNow(clock, Date.now()).toISOString());
    update();
    if (clock.paused) return;
    const i = setInterval(update, 500);
    return () => clearInterval(i);
  }, [clock]);
  return now;
}

export function sessionIdFromUrl(): string {
  if (typeof window === "undefined") return "DEMO-7";
  const q = new URLSearchParams(window.location.search).get("session");
  if (q) { try { localStorage.setItem("pakka-session", q); } catch { /* storage blocked */ } return q; }
  try { return localStorage.getItem("pakka-session") ?? "DEMO-7"; } catch { return "DEMO-7"; }
}

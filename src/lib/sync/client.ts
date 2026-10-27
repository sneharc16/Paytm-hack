"use client";
// Client sync: each surface keeps a replica of the session (same world, same reducer) and polls the
// server for new events. Taps are sent as commands; the UI shows results only once events arrive.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { SESSION_START, simNow, type ClockState } from "@/engine/clock";
import type { ClockCommand, Command } from "@/engine/commands";
import { ingest, Session } from "@/engine/session";
import type { PakkaEvent, World } from "@/engine/types";
import { generateWorld } from "@/engine/world";

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

let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;

export const useSync = create<SyncState>((set, get) => ({
  id: "",
  session: null,
  epoch: 0,
  clock: { simAnchor: SESSION_START, realAnchor: 0, speed: 60, paused: true },
  version: 0,
  failures: [],
  connected: false,
  start(id) {
    if (get().id === id && get().session) return;
    set({ id, session: new Session(id, world()), epoch: 0, version: 0 });
    const loop = async () => {
      await get().poll();
      timer = setTimeout(loop, get().clock.paused ? 1500 : 500);
    };
    if (timer) clearTimeout(timer);
    void loop();
  },
  async poll() {
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
    const res = await fetch(`/api/sessions/${get().id}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
    const body = await res.json();
    await get().poll();
    return body.data;
  },
  async clockCmd(c) {
    await fetch(`/api/sessions/${get().id}/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
    await get().poll();
  },
}));

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

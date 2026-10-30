"use client";
// The business console's store. Runs the B2B engine in the browser, separate from the consumer demo's sync: its
// own world, its own localStorage key. The doc is (sim time, list of timed actions), so a reload replays to the
// exact same ledger.
import { create } from "zustand";
import { B2B_END, B2B_START } from "@/b2b/clock";
import type { B2BCommand, CommandResult } from "@/b2b/commands";
import { checkB2BInvariants } from "@/b2b/invariants";
import { Treasury } from "@/b2b/treasury";
import type { BusinessWorld, ISO } from "@/b2b/types";
import { generateBusinessWorld, KAVERI, SAANJH } from "@/b2b/world";

type Takeover = Treasury["compromised"];
type Entry = { at: ISO; co: string; cmd?: B2BCommand; takeover?: Takeover };
interface Doc { v: 1; at: ISO; autoplay: boolean; entries: Entry[] }

const KEY = "pakka-b2b-v1";
let worldCache: BusinessWorld | null = null;
export const businessWorld = () => (worldCache ??= generateBusinessWorld("2711"));

const fresh = (): Doc => ({ v: 1, at: B2B_START, autoplay: true, entries: [] });
function load(): Doc {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (d?.v === 1) return d; } } catch { /* storage blocked */ }
  return fresh();
}
const save = (d: Doc) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage blocked */ } };

function build(d: Doc): Record<string, Treasury> {
  const out: Record<string, Treasury> = {};
  for (const co of [SAANJH, KAVERI]) {
    const t = new Treasury(businessWorld(), co, { autoplay: d.autoplay });
    for (const e of d.entries.filter((x) => x.co === co)) {
      if (e.takeover) t.simulateTakeover(e.at, e.takeover);
      else if (e.cmd) t.command(e.at, e.cmd);
    }
    t.advance(d.at);
    out[co] = t;
  }
  return out;
}

interface B2BState {
  ready: boolean;
  doc: Doc;
  treasuries: Record<string, Treasury>;
  version: number;
  failures: string[];
  init: () => void;
  setTime: (at: ISO) => void;
  send: (co: string, cmd: B2BCommand) => CommandResult;
  takeover: (co: string, t: Takeover) => void;
  setAutoplay: (on: boolean) => void;
  reset: () => void;
}

export const useB2B = create<B2BState>((set, get) => {
  const commit = (doc: Doc, treasuries: Record<string, Treasury>) => {
    save(doc);
    const failures = Object.values(treasuries).flatMap((t) => checkB2BInvariants(t).map((f) => `${t.companyId}: ${f}`));
    set({ doc, treasuries, version: get().version + 1, failures });
  };
  return {
    ready: false, doc: fresh(), treasuries: {}, version: 0, failures: [],
    init() {
      if (get().ready) return;
      const doc = load();
      set({ ready: true });
      commit(doc, build(doc));
      window.addEventListener("storage", (e) => { if (e.key === KEY) { const d = load(); commit(d, build(d)); } });
    },
    setTime(at) {
      const { doc, treasuries } = get();
      const to = at > B2B_END ? B2B_END : at < B2B_START ? B2B_START : at;
      if (to >= doc.at) {
        for (const t of Object.values(treasuries)) t.advance(to);
        commit({ ...doc, at: to }, treasuries);
      } else {
        // Going back in time drops what was done after that moment.
        const d = { ...doc, at: to, entries: doc.entries.filter((e) => e.at <= to) };
        commit(d, build(d));
      }
    },
    send(co, cmd) {
      const { doc, treasuries } = get();
      const r = treasuries[co].command(doc.at, cmd);
      commit({ ...doc, entries: [...doc.entries, { at: doc.at, co, cmd }] }, treasuries);
      return r;
    },
    takeover(co, tk) {
      const { doc, treasuries } = get();
      treasuries[co].simulateTakeover(doc.at, tk);
      commit({ ...doc, entries: [...doc.entries, { at: doc.at, co, takeover: tk }] }, treasuries);
    },
    setAutoplay(on) {
      const d = { ...get().doc, autoplay: on };
      commit(d, build(d));
    },
    reset() {
      const d = fresh();
      commit(d, build(d));
    },
  };
});

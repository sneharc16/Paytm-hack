"use client";
// Pakka live in the browser. The server owns the person's log and clock; this keeps a replica Session built
// from the same pure world builder and the server's events, so the phone screens read it like the demo's.
// Passkeys: sign-up and sign-in, and each pause or cancel is signed again on this device.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { create } from "zustand";
import { challengeFor, type RelyingParty } from "@/b2b/crypto";
import type { UiLang } from "@/copy/languages";
import type { Command } from "@/engine/commands";
import { buildLiveWorld, type AutopayInput, type LiveAutopay } from "@/engine/live";
import { ingest, Session } from "@/engine/session";
import type { ISO, Lang, PakkaEvent } from "@/engine/types";

type Api<T> = { ok: true; data: T } | { ok: false; error: { code: string; message?: string } };
async function api<T>(path: string, body?: unknown): Promise<Api<T>> {
  try {
    const res = await fetch(`/api/live/${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as Api<T>;
  } catch { return { ok: false, error: { code: "NETWORK" } }; }
}

export interface LiveProfileView { id: string; name: string; uiLang: UiLang; lang: Lang; startAt: ISO; passkeys: { id: string; addedAt: string }[] }
interface StateView { profile: LiveProfileView; autopays: LiveAutopay[]; until: ISO; events: PakkaEvent[]; total: number; serverTime: ISO; rp?: RelyingParty }
export interface SmsDraft { brand: string | null; legalName: string | null; amount: number | null; interval: "month" | "quarter" | "year" | null; nextDue: string | null; kind: AutopayInput["kind"] }

interface LiveState {
  phase: "loading" | "signed_out" | "in";
  profile: LiveProfileView | null;
  autopays: LiveAutopay[];
  session: Session | null;
  rp: RelyingParty | null;
  /** Server time minus this device's time, so the clock on screen is the server's. */
  skewMs: number;
  version: number;
  refresh: () => Promise<void>;
  apply: (v: StateView, full: boolean) => void;
  signUp: (name: string, lang: UiLang) => Promise<string | null>;
  signIn: () => Promise<string | null>;
  signOut: () => Promise<void>;
  setLang: (lang: UiLang) => Promise<void>;
  addAutopay: (a: AutopayInput) => Promise<string | null>;
  removeAutopay: (id: string) => Promise<string | null>;
  readSms: (text: string) => Promise<{ draft: SmsDraft; found: boolean; by: string } | { error: string }>;
  send: (c: Command) => Promise<unknown>;
  confirm: (cycleId: string, choice: "pause" | "cancel") => Promise<{ status: string } | { error: string }>;
}

let worldKey = "";
const keyOf = (v: StateView) => JSON.stringify([v.profile.id, v.profile.lang, v.profile.name, v.profile.startAt, v.autopays, v.until]);

export const useLive = create<LiveState>((set, get) => ({
  phase: "loading", profile: null, autopays: [], session: null, rp: null, skewMs: 0, version: 0,

  apply(v, full) {
    const k = keyOf(v);
    let s = get().session;
    // The world changed (an AutoPay added, a new month entering the horizon): rebuild from the full log.
    if (!s || k !== worldKey || full) {
      s = new Session(v.profile.id, buildLiveWorld(v.profile, v.autopays, v.until), []);
      worldKey = k;
      if (!full) { void get().refresh(); return; }
    }
    ingest(s, v.events);
    set({ phase: "in", profile: v.profile, autopays: v.autopays, session: s, rp: v.rp ?? get().rp, skewMs: Date.parse(v.serverTime) - Date.now(), version: get().version + 1 });
  },

  async refresh() {
    const s = get().session;
    const known = s && worldKey ? s.events.length : 0;
    const r = await api<StateView>(`state?after=${known}`);
    if (!r.ok) { if (r.error.code === "SIGN_IN") set({ phase: "signed_out", session: null, profile: null }); return; }
    if (known && keyOf(r.data) !== worldKey) {
      const all = await api<StateView>("state?after=0");
      if (all.ok) get().apply(all.data, true);
      return;
    }
    get().apply(r.data, !known);
  },

  async signUp(name, lang) {
    const o = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("signup/options", { name, lang });
    if (!o.ok) return o.error.code;
    let response;
    try { response = await startRegistration({ optionsJSON: o.data.options }); } catch { return "PASSKEY_CANCELLED"; }
    const f = await api<{ id: string }>("signup/finish", { response });
    if (!f.ok) return f.error.code;
    worldKey = ""; await get().refresh();
    return null;
  },

  async signIn() {
    const o = await api<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("signin/options", {});
    if (!o.ok) return o.error.code;
    let assertion;
    try { assertion = await startAuthentication({ optionsJSON: o.data.options }); } catch { return "PASSKEY_CANCELLED"; }
    const f = await api<{ id: string }>("signin/finish", { assertion });
    if (!f.ok) return f.error.code;
    worldKey = ""; await get().refresh();
    return null;
  },

  async signOut() {
    await api("signout", {});
    worldKey = "";
    set({ phase: "signed_out", session: null, profile: null, autopays: [] });
  },

  async setLang(lang) {
    const r = await api<StateView>("profile", { lang });
    if (r.ok) get().apply(r.data, true);
  },

  async addAutopay(autopay) {
    const r = await api<StateView>("autopays", { autopay });
    if (!r.ok) return r.error.code;
    get().apply(r.data, true);
    return null;
  },

  async removeAutopay(id) {
    const r = await api<StateView>("autopays/remove", { id });
    if (!r.ok) return r.error.code;
    get().apply(r.data, true);
    return null;
  },

  async readSms(text) {
    const r = await api<{ draft: SmsDraft; found: boolean; by: string }>("sms", { text });
    return r.ok ? r.data : { error: r.error.code };
  },

  async send(command) {
    const r = await api<StateView & { result: unknown }>("command", { command });
    if (!r.ok) return null;
    get().apply(r.data, true);
    return r.data.result;
  },

  async confirm(cycleId, choice) {
    const { profile, rp } = get();
    if (!profile || !rp) return { error: "SIGN_IN" };
    const ts = new Date(Date.now() + get().skewMs).toISOString();
    const message = `PAKKA_LIVE_CONFIRM_V1|${profile.id}|${cycleId}|${choice}|${ts}`;
    let assertion;
    try {
      assertion = await startAuthentication({ optionsJSON: { challenge: challengeFor(message), rpId: rp.rpId, userVerification: "required", timeout: 120_000, allowCredentials: profile.passkeys.map((p) => ({ id: p.id, type: "public-key" as const })) } });
    } catch { return { error: "PASSKEY_CANCELLED" }; }
    const r = await api<StateView & { result: { status: string } }>("command", { command: { kind: "customer_decision", cycleId, choice }, confirm: { ts, assertion } });
    if (!r.ok) return { error: r.error.code };
    get().apply(r.data, true);
    return { status: r.data.result?.status ?? "executed" };
  },
}));

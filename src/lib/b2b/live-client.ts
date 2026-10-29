"use client";
// The live console's client. It keeps a replica of the company's ledger (fetched from the API and replayed with
// the same engine), and signs every action with the person's passkey in this browser before sending it.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { create } from "zustand";
import { challengeFor, type WebAuthnSig } from "@/b2b/crypto";
import { loadOrg, messageFor } from "@/b2b/live";
import type { Treasury } from "@/b2b/treasury";
import type { Company, LedgerEvent, Person } from "@/b2b/types";

export type Api<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; missing?: string[] } };

export async function api<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<Api<T>> {
  try {
    const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", credentials: "same-origin" });
    return (await res.json()) as Api<T>;
  } catch (e) {
    return { ok: false, error: { code: "NETWORK", message: String(e) } };
  }
}

interface Me { orgId: string; person: Person; company: Company; rp: { rpId: string; origins: string[] }; serverTime: string }

interface LiveState {
  status: "loading" | "signed_out" | "ready";
  me: Me | null;
  t: Treasury | null;
  version: number;
  skewMs: number;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  now: () => string;
  /** Sign `command` with a passkey and send it. */
  act: (command: Record<string, unknown> & { kind: string }) => Promise<Api<Record<string, unknown>>>;
  signOut: () => Promise<void>;
}

let timer: ReturnType<typeof setInterval> | null = null;

export const useLive = create<LiveState>((set, get) => ({
  status: "loading", me: null, t: null, version: 0, skewMs: 0,
  async init() {
    const m = await api<Me>("GET", "/api/v1/live/me");
    if (!m.ok) { set({ status: "signed_out", me: null, t: null }); return; }
    set({ me: m.data, skewMs: new Date(m.data.serverTime).getTime() - Date.now() });
    await get().refresh();
    set({ status: "ready" });
    if (timer) clearInterval(timer);
    timer = setInterval(() => { void get().refresh(); }, 3000);
  },
  async refresh() {
    const t = get().t;
    const r = await api<{ events: LedgerEvent[]; total: number; head: string; serverTime: string }>("GET", `/api/v1/live/events?after=${t?.events.length ?? 0}`);
    if (!r.ok) { if (r.error.code === "SIGN_IN") set({ status: "signed_out" }); return; }
    if (!r.data.events.length && t) return;
    let next = t;
    if (!next || r.data.events[0]?.seq !== next.events.length + 1) {
      const all = await api<{ events: LedgerEvent[] }>("GET", "/api/v1/live/events?after=0");
      if (!all.ok) return;
      next = loadOrg(all.data.events);
    } else {
      for (const e of r.data.events) { next.events.push(e); next.state.apply(e); }
      next.processedTo = r.data.events.at(-1)!.at;
    }
    const me = get().me;
    const fresh = me ? next.world.people.find((p) => p.id === me.person.id) : undefined;
    set({ t: next, version: get().version + 1, ...(fresh && me ? { me: { ...me, person: { ...me.person, roles: fresh.roles, credentials: fresh.credentials } } } : {}) });
  },
  now: () => new Date(Date.now() + get().skewMs).toISOString(),
  async act(command) {
    const { t, me } = get();
    if (!t || !me) return { ok: false, error: { code: "SIGN_IN", message: "Sign in first" } };
    const at = get().now();
    const message = messageFor(t, me.person.id, command, at);
    let webauthn: WebAuthnSig;
    try {
      const a = await startAuthentication({ optionsJSON: { challenge: challengeFor(message), rpId: me.rp.rpId, userVerification: "required", timeout: 120_000, allowCredentials: (me.person.credentials ?? []).map((c) => ({ id: c.id, type: "public-key" as const })) } });
      webauthn = { credentialId: a.id, authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: a.response.signature };
    } catch (e) {
      return { ok: false, error: { code: "PASSKEY_CANCELLED", message: String((e as Error).message ?? e).slice(0, 160) } };
    }
    const r = await api<Record<string, unknown>>("POST", "/api/v1/live/commands", { command: { ...command, auth: { at, webauthn } } });
    await get().refresh();
    return r;
  },
  async signOut() {
    await api("DELETE", "/api/v1/live/session");
    if (timer) clearInterval(timer);
    set({ status: "signed_out", me: null, t: null });
  },
}));

// ---------------- passkey ceremonies ----------------
type Opts = { options: Parameters<typeof startRegistration>[0]["optionsJSON"] };

export async function createCompany(org: unknown): Promise<Api<{ orgId: string }>> {
  const o = await api<Opts>("POST", "/api/v1/live/orgs/options", { org });
  if (!o.ok) return o;
  try {
    const response = await startRegistration({ optionsJSON: o.data.options });
    return api("POST", "/api/v1/live/orgs", { response });
  } catch (e) { return { ok: false, error: { code: "PASSKEY_CANCELLED", message: String((e as Error).message ?? e) } }; }
}

export async function signIn(): Promise<Api<{ orgId: string }>> {
  const o = await api<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("POST", "/api/v1/live/session/options", {});
  if (!o.ok) return o;
  try {
    const assertion = await startAuthentication({ optionsJSON: o.data.options });
    return api("POST", "/api/v1/live/session", { assertion });
  } catch (e) { return { ok: false, error: { code: "PASSKEY_CANCELLED", message: String((e as Error).message ?? e) } }; }
}

export async function joinCompany(org: string, invite: string, token: string): Promise<Api<{ orgId: string }>> {
  const o = await api<Opts & { invite: { name: string } }>("POST", "/api/v1/live/join/options", { org, invite, token });
  if (!o.ok) return o;
  try {
    const response = await startRegistration({ optionsJSON: o.data.options });
    return api("POST", "/api/v1/live/join", { response });
  } catch (e) { return { ok: false, error: { code: "PASSKEY_CANCELLED", message: String((e as Error).message ?? e) } }; }
}

export async function addDevice(): Promise<Api<Record<string, unknown>>> {
  const o = await api<Opts>("POST", "/api/v1/live/passkeys/options", {});
  if (!o.ok) return o;
  try {
    const response = await startRegistration({ optionsJSON: o.data.options });
    return api("POST", "/api/v1/live/passkeys", { response });
  } catch (e) { return { ok: false, error: { code: "PASSKEY_CANCELLED", message: String((e as Error).message ?? e) } }; }
}

export const previewInvite = (org: string, invite: string, token: string) => api<{ invite: { name: string; title: string; roles: string[]; company: string } }>("POST", "/api/v1/live/join/options", { org, invite, token });

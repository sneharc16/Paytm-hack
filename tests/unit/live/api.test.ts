// Pakka live through its real HTTP handlers, with a software passkey producing real WebAuthn bytes.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SoftPasskey } from "@/b2b/testing/softPasskey";
import { MemoryStore, setB2BStoreForTests } from "@/lib/server/b2b/store";
import { MemoryLiveStore, setLiveStoreForTests } from "@/lib/server/live/store";
import * as h from "@/lib/server/live/handlers";

const ORIGIN = "http://localhost:3000";
const rp = { rpId: "localhost", origins: [ORIGIN] };
let jar: Record<string, string> = {};
async function call(fn: (r: Request) => Promise<Response>, path: string, body?: unknown) {
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  const res = await fn(new Request(`${ORIGIN}/api/live/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie }, body: body === undefined ? undefined : JSON.stringify(body) }));
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, ...v] = kv.split("="); jar[k] = decodeURIComponent(v.join("=")); if (/Max-Age=0/.test(c)) delete jar[k]; }
  return (await res.json()) as { ok: boolean; data?: any; error?: { code: string } };
}
const ist = (s: string) => new Date(`${s}+05:30`);

describe("Pakka live API", () => {
  const key = new SoftPasskey("live-meera", rp);
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ist("2026-11-02T11:30:00"));
    setLiveStoreForTests(new MemoryLiveStore());
    setB2BStoreForTests(new MemoryStore());
    delete process.env.SARVAM_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env.LLM_API_KEY;
  });
  afterAll(() => vi.useRealTimers());

  let userId = "";
  it("signs up with a passkey and nothing else", async () => {
    const o = await call(h.signUpOptions, "signup/options", { name: "Meera Rao", lang: "ta" });
    expect(o.ok).toBe(true);
    const f = await call(h.signUpFinish, "signup/finish", { response: key.register(o.data.options.challenge) });
    expect(f.ok, JSON.stringify(f.error)).toBe(true);
    userId = f.data.id;
    const s = await call(h.state, "state");
    expect(s.data.profile).toMatchObject({ name: "Meera Rao", uiLang: "ta", lang: "en" });
    expect(s.data.autopays).toEqual([]);
  });

  it("refuses a request without the session", async () => {
    const saved = jar; jar = {};
    expect((await call(h.state, "state")).error?.code).toBe("SIGN_IN");
    jar = saved;
  });

  it("adds a real AutoPay and refuses a date already gone", async () => {
    const autopay = { brand: "Readwell", legalName: "Pustak Digital Pvt Ltd", kind: "subscription", amount: 59900, interval: "month", nextDue: "2026-11-05", trial: { amount: 100, startedOn: "2026-10-29" } };
    expect((await call(h.addAutopay, "autopays", { autopay: { ...autopay, nextDue: "2026-11-01" } })).error?.code).toBe("NEXT_DUE_IN_PAST");
    const r = await call(h.addAutopay, "autopays", { autopay });
    expect(r.ok).toBe(true);
    expect(r.data.autopays).toHaveLength(1);
  });

  it("lets the wall clock run: the notice arrives and Pakka asks", async () => {
    vi.setSystemTime(ist("2026-11-04T22:40:00"));
    const s = await call(h.state, "state");
    const types = s.data.events.map((e: { type: string }) => e.type);
    expect(types).toContain("notice_received");
    expect(types).toContain("nudge_sent");
  });

  it("will not pause without the passkey, and pauses with it", async () => {
    const cycleId = (await call(h.state, "state")).data.autopays[0].id + "_c1";
    expect((await call(h.command, "command", { command: { kind: "customer_decision", cycleId, choice: "pause" } })).error?.code).toBe("CONFIRM_WITH_PASSKEY");
    const ts = new Date().toISOString();
    const sig = key.sign(h.confirmMessage(userId, cycleId, "pause", ts));
    const assertion = { id: sig.credentialId, response: { authenticatorData: sig.authenticatorData, clientDataJSON: sig.clientDataJSON, signature: sig.signature } };
    const r = await call(h.command, "command", { command: { kind: "customer_decision", cycleId, choice: "pause" }, confirm: { ts, assertion } });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect((await call(h.command, "command", { command: { kind: "customer_decision", cycleId, choice: "pause" }, confirm: { ts, assertion } })).error?.code).toBe("REPLAYED_SIGNATURE");
    vi.setSystemTime(ist("2026-11-06T09:00:00"));
    const s = await call(h.state, "state");
    expect(s.data.events.some((e: { type: string }) => e.type === "execution_succeeded")).toBe(false);
    expect(s.data.events.some((e: { type: string; ruleId?: string }) => e.type === "action_executed" && e.ruleId === "USER_OPT_OUT_V1")).toBe(true);
  });

  it("asks only about yourself", async () => {
    const r = await call(h.command, "command", { command: { kind: "question", userId: "u_sunita", text: "Readwell ka charge kyun?" } });
    expect(r.ok).toBe(true);
    expect(r.data.events.filter((e: { type: string }) => e.type === "question_asked").at(-1).payload.userId).toBe(userId);
  });

  it("signs back in with the same passkey", async () => {
    await call(h.signOut, "signout", {});
    expect((await call(h.state, "state")).error?.code).toBe("SIGN_IN");
    const o = await call(h.signInOptions, "signin/options", {});
    const a = key.assert(o.data.options.challenge, `live:${userId}`);
    const f = await call(h.signInFinish, "signin/finish", { assertion: a });
    expect(f.ok, JSON.stringify(f.error)).toBe(true);
    expect((await call(h.state, "state")).data.profile.id).toBe(userId);
  });

  it("reads a bank SMS by rules when no model is set", () => {
    const d = h.readSmsByRules("AutoPay set up: Rs.299.00 will be debited monthly for StreamKaro to Chalchitra Digital Pvt Ltd. Next debit on 15-11-2026. UMN abc@okbank", "2026-11-06");
    expect(d).toMatchObject({ amount: 29900, legalName: "Chalchitra Digital Pvt Ltd", interval: "month", nextDue: "2026-11-15", kind: "subscription", brand: "StreamKaro" });
  });
});

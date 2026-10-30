import { afterEach, describe, expect, it, vi } from "vitest";
import { versionFor } from "@/llm/cache";
import { runTask, setClientForTests, setGeminiForTests } from "@/llm/client";

function fakeClient(response: unknown) {
  return { beta: { messages: { parse: vi.fn().mockResolvedValue(response) } } };
}

describe("model client", () => {
  afterEach(() => setClientForTests(null));

  it("falls back when no key is set", async () => {
    const r = await runTask("intake", { text: "ye 599 kya kata?" }, { useDemoCache: false });
    expect(r).toMatchObject({ ok: false, reason: "llm_off", promptVersion: versionFor("intake") });
  });

  it("returns validated output and the model that wrote it", async () => {
    const out = { pass: true, issues: [] };
    const c = fakeClient({ stop_reason: "end_turn", model: "claude-haiku-5-5", parsed_output: out });
    setClientForTests(c);
    const r = await runTask("lint", { text: "Jab chahein wapas aa sakte hain 1" }, { useDemoCache: false });
    expect(r).toMatchObject({ ok: true, output: out, model: "claude-haiku-5-5", cacheHit: false });
    const req = c.beta.messages.parse.mock.calls[0][0];
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.output_config.effort).toBe("low");
    expect(req.temperature).toBeUndefined();
    // Second identical call is served from this process's cache.
    expect(await runTask("lint", { text: "Jab chahein wapas aa sakte hain 1" }, { useDemoCache: false })).toMatchObject({ ok: true, cacheHit: true });
  });

  it("asks for the server-side refusal fallback on the Sonnet route", async () => {
    const c = fakeClient({ stop_reason: "end_turn", model: "claude-sonnet-5-5", parsed_output: { headline: "h", detail: "d" } });
    setClientForTests(c);
    await runTask("alert", { count: 1 }, { useDemoCache: false });
    const req = c.beta.messages.parse.mock.calls[0][0];
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
  });

  it("treats a refusal or invalid output as a failure", async () => {
    setClientForTests(fakeClient({ stop_reason: "refusal", model: "m", parsed_output: null }));
    expect(await runTask("lint", { text: "a" }, { useDemoCache: false })).toMatchObject({ ok: false, reason: "refusal" });
    setClientForTests(fakeClient({ stop_reason: "end_turn", model: "m", parsed_output: { pass: "yes" } }));
    expect(await runTask("lint", { text: "b" }, { useDemoCache: false })).toMatchObject({ ok: false, reason: "invalid_output" });
  });
});

describe("Gemini provider (free tier)", () => {
  afterEach(() => { setGeminiForTests(null); });

  it("asks for JSON matching the schema and validates the answer", async () => {
    const out = { pass: false, issues: [{ pattern: "confirm_shaming", span: "aap pachhtayenge", why: "guilt", suggested_fix: "Jab chahein wapas aa sakte hain." }] };
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(out), modelVersion: "gemini-2.5-flash-lite", candidates: [{ finishReason: "STOP" }] });
    setGeminiForTests({ models: { generateContent } });
    const r = await runTask("lint", { text: "aap pachhtayenge 2" }, { useDemoCache: false });
    expect(r).toMatchObject({ ok: true, output: out, model: "gemini-2.5-flash-lite" });
    const req = generateContent.mock.calls[0][0];
    expect(req.config.responseMimeType).toBe("application/json");
    expect(req.config.responseJsonSchema.properties.issues).toBeDefined();
    expect(req.config.systemInstruction).toContain("dark pattern");
  });

  it("treats a safety stop or bad JSON as a failure", async () => {
    setGeminiForTests({ models: { generateContent: vi.fn().mockResolvedValue({ text: "", candidates: [{ finishReason: "SAFETY" }] }) } });
    expect(await runTask("lint", { text: "c" }, { useDemoCache: false })).toMatchObject({ ok: false, reason: "refusal" });
    setGeminiForTests({ models: { generateContent: vi.fn().mockResolvedValue({ text: "not json", candidates: [{ finishReason: "STOP" }] }) } });
    expect(await runTask("lint", { text: "d" }, { useDemoCache: false })).toMatchObject({ ok: false, reason: "invalid_output" });
  });
});

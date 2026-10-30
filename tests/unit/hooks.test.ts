import { describe, expect, it, vi } from "vitest";

// A demo cache with one good and one bad reminder, to check the engine path end to end.
vi.mock("@/llm/cache", async (orig) => {
  const real = await orig<typeof import("@/llm/cache")>();
  return {
    ...real,
    lookup: (task: string, input: { language?: string; kind?: string }) => {
      if (task !== "reminder" || input.kind !== "ask") return undefined;
      if (input.language === "hi") return { model: "claude-sonnet-5-5", output: { title: "कल ₹599 PadhoAI को जाएंगे", body: "जवाब दीजिए।", voice_script: "कल रात पैसा कटेगा।", language: "hi" } };
      return { model: "claude-sonnet-5-5", output: { title: "Kal ₹699 PadhoAI ko jaayenge", body: "x", voice_script: "x", language: input.language } };
    },
  };
});

describe("model hooks in the engine", async () => {
  const { installModelHooks } = await import("@/llm/hooks");
  const { generateWorld } = await import("@/engine/world");
  const { Session } = await import("@/engine/session");
  const { tick } = await import("@/engine/agent");
  const { ist } = await import("@/engine/clock");
  const { versionFor } = await import("@/llm/cache");
  installModelHooks();
  const s = new Session("HOOK", generateWorld("2711"));
  tick(s, ist("2026-10-26 21:11"));
  const asks = s.events.filter((e) => e.type === "nudge_sent" && e.payload.kind === "ask");

  it("uses fact-checked model text and records the prompt version", () => {
    const sunita = asks.find((e) => e.payload.userId === "u_sunita")!;
    expect(sunita.modelVersion).toBe(versionFor("reminder"));
    expect(sunita.payload.title).toBe("कल ₹599 PadhoAI को जाएंगे");
  });
  it("falls back to the template when the fact-check fails (RT-05)", () => {
    const hinglish = asks.find((e) => e.payload.language === "hinglish")!;
    expect(hinglish.modelVersion).toBe("template");
    expect(hinglish.payload.fallback).toContain("factcheck_failed");
    expect(hinglish.payload.title).toContain("₹599");
  });
});

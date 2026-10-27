import { describe, expect, it } from "vitest";
import { scoreCycle, type RiskInput } from "@/engine/risk";

const base: RiskInput = {
  cycleId: "c", at: "2026-10-26T15:40:00.000Z", amount: 59900, trialAmount: 100, firstCharge: true, usage: "not_opened",
  nameGap: true, openIncident: true, medianRecent: null, quickCancelHistory: false, irrevocable: false,
  knownObligation: false, alwaysKeep: false, confirmed: false,
};

describe("mandate-risk-v1 worked examples (PRD 11.6)", () => {
  it.each([
    ["Sunita, PadhoAI", {}, 90, "ask"],
    ["PadhoAI, no consent", { usage: "unknown" }, 73, "ask"],
    ["PadhoAI, opened the app", { usage: "opened" }, 45, "tell"],
    ["KathaKosh, no consent", { amount: 19900, usage: "unknown", openIncident: false }, 63, "ask"],
    ["Rahul, StadiumPass", { amount: 29900, trialAmount: null, firstCharge: false, usage: "opened", openIncident: false }, 0, "list"],
    ["Nivesh SIP", { amount: 200000, trialAmount: null, firstCharge: false, usage: "unknown", nameGap: false, openIncident: false, knownObligation: true }, 8, "list"],
  ] as const)("%s", (_n, over, score, band) => {
    const r = scoreCycle({ ...base, ...over } as RiskInput);
    expect(r.score).toBe(score);
    expect(r.band).toBe(band);
  });
  it("Sunita's contributions are +30, +15, +25, +10, +10", () => {
    expect(scoreCycle(base).contributions.map((c) => [c.label, c.points])).toEqual([
      ["Trial jump", 30], ["First real charge", 15], ["App not opened", 25], ["Name gap", 10], ["Open incident", 10],
    ]);
  });
  it("is List when already confirmed, whatever the score", () => {
    expect(scoreCycle({ ...base, usage: "opened", confirmed: true }).band).toBe("list");
  });
  it("gives irrevocable mandates no score", () => {
    expect(scoreCycle({ ...base, irrevocable: true }).band).toBe("remind_only");
  });
  it("caps known obligations at 30 and always-keep at 0", () => {
    expect(scoreCycle({ ...base, knownObligation: true }).score).toBe(30);
    expect(scoreCycle({ ...base, alwaysKeep: true }).score).toBe(0);
  });
});

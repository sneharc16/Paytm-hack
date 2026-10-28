import { describe, expect, it } from "vitest";
import { generateWorld } from "@/engine/world";
import { Session } from "@/engine/session";
import { tick } from "@/engine/agent";
import { DEMO_END } from "@/engine/clock";
import { metrics } from "@/engine/metrics";
import { checkInvariants } from "@/engine/invariants";

describe("full scenario, 26 Oct 8:55 PM to 29 Oct 6:00 AM, autoplayed personas", () => {
  const world = generateWorld("2711");
  const s = new Session("TEST-1", world);
  tick(s, DEMO_END);
  const m = metrics(s);

  it("hits the expected counters in 25.6", () => {
    expect(m.unwantedStopped).toBe(15933400);
    expect(m.atRiskCollected).toBe(5501600);
    expect(m.keptBySkipOrPause).toBe(201);
    expect(m.refundedUnderMerchantRules).toBe(1257900);
    expect(m.casesToPerson).toBe(2);
    expect(m.movedWithoutRule).toBe(0);
    expect(m.choiceBreakdown).toEqual({ keep: 52, skip: 140, downgrade: 0, pause: 61, cancel: 47, none: 18 });
  });
  it("matches the sweep and reminder counts in J1", () => {
    expect(m.sweep.dueFirst).toBe(410);
    expect(m.sweep.confirmed).toBe(92);
    expect(m.sweep.needYes).toBe(318);
    expect(m.sweep.remindersByLang).toEqual({ hi: 142, hinglish: 131, en: 45 });
    expect(s.state.incidents.get("INC-07")?.metrics).toMatchObject({ count: 46, consent: 38, name: 6, ownership: 2 });
  });
  it("holds every invariant in 13.5", () => {
    expect(checkInvariants(s)).toEqual([]);
  });
  it("scores Sunita at exactly 90 and skips her cycle with A-5521", () => {
    const sunita = world.cycles.find((c) => world.mandates.find((x) => x.id === c.mandateId)!.userId === "u_sunita" && c.group === "ask")!;
    const score = s.events.find((e) => e.type === "risk_scored" && e.payload.cycleId === sunita.id)!;
    expect(score.payload.score).toBe(90);
    expect(score.payload.contributions.map((c: { points: number }) => c.points)).toEqual([30, 15, 25, 10, 10]);
    expect(s.state.cycle(sunita.id).status).toBe("skipped");
    expect(s.events.some((e) => e.type === "action_planned" && e.payload.actionId === "A-5521")).toBe(true);
  });
  it("gives Farhan PAK-2311 with code 4821 and Anjali PAK-2314 in the fraud lane", () => {
    expect(s.state.cases.get("PAK-2311")?.callback?.code).toBe("4821");
    expect(s.state.cases.get("PAK-2311")?.status).toBe("closed");
    expect(s.state.cases.get("PAK-2314")?.type).toBe("fraud");
    expect(s.state.cases.has("PAK-2309")).toBe(true);
  });
  it("retries Rahul at 9:41 PM on 28 Oct, after the peak window", () => {
    const rahul = world.cycles.find((c) => c.group === "collect" && c.seq === 2 && world.mandates.find((x) => x.id === c.mandateId)!.userId === "u_rahul")!;
    const attempts = s.events.filter((e) => e.type === "execution_attempted" && e.payload.cycleId === rahul.id);
    expect(attempts.map((e) => e.simAt)).toEqual(["2026-10-27T18:10:00.000Z", "2026-10-28T16:11:00.000Z"]);
    expect(s.state.cycle(rahul.id).status).toBe("succeeded");
  });
  it("is idempotent: replaying the log and ticking again adds nothing", () => {
    const again = new Session("TEST-1", world, s.events);
    expect(tick(again, DEMO_END)).toEqual([]);
    expect(metrics(again)).toEqual(m);
  });
});

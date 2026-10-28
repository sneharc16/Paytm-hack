import { beforeEach, describe, expect, it } from "vitest";
import { clockCommand, command, eventsSince } from "@/lib/server/sessions";
import { memoryStore, setStoreForTests } from "@/lib/server/store";
import { DEMO_END, ist } from "@/engine/clock";
import { Session, ingest } from "@/engine/session";
import { generateWorld } from "@/engine/world";
import { metrics } from "@/engine/metrics";

const world = generateWorld("2711");
const replica = async (id: string) => {
  const d = await eventsSince(id, 0, 0);
  const s = new Session(id, world);
  ingest(s, d.events);
  return { s, d };
};

describe("shared sessions on the server", () => {
  beforeEach(() => setStoreForTests(memoryStore()));

  it("plays the whole story through the API and ends on the PRD numbers", async () => {
    await clockCommand("SRV-1", { action: "jump", value: DEMO_END });
    const { s } = await replica("SRV-1");
    const m = metrics(s);
    expect(m.unwantedStopped).toBe(15933400);
    expect(m.atRiskCollected).toBe(5501600);
    expect(m.movedWithoutRule).toBe(0);
  });

  it("keeps one gap-free log when two servers race", async () => {
    await clockCommand("SRV-2", { action: "jump", value: ist("2026-10-26 21:11") });
    const sunita = world.cycles.find((c) => c.group === "ask" && world.mandates.find((m) => m.id === c.mandateId)!.userId === "u_sunita")!;
    const [a, b] = await Promise.all([
      command("SRV-2", { kind: "customer_decision", cycleId: sunita.id, choice: "skip" }),
      command("SRV-2", { kind: "customer_decision", cycleId: sunita.id, choice: "skip" }),
    ]);
    expect([a, b].map((r) => (r as { actionId: string }).actionId)).toEqual(["A-5521", "A-5521"]);
    const { d } = await replica("SRV-2");
    expect(d.events.map((e) => e.id)).toEqual(d.events.map((_, i) => i + 1));
    expect(d.events.filter((e) => e.type === "notice_withdrawn" && e.payload.cycleId === sunita.id)).toHaveLength(1);
  });

  it("restarts with a new epoch and an empty log", async () => {
    await clockCommand("SRV-3", { action: "jump", value: ist("2026-10-26 21:11") });
    await clockCommand("SRV-3", { action: "restart" });
    const d = await eventsSince("SRV-3", 0, 0);
    expect(d.epoch).toBe(2);
    expect(d.events).toHaveLength(0);
  });
});

describe("catching up from the log", () => {
  beforeEach(() => setStoreForTests(memoryStore()));

  it("loses no scripted answer when a tap lands right before one (cold replay mid-second)", async () => {
    const sunita = world.cycles.find((c) => c.group === "ask" && world.mandates.find((m) => m.id === c.mandateId)!.userId === "u_sunita")!;
    await clockCommand("SRV-4", { action: "jump", value: ist("2026-10-26 21:11") });
    await command("SRV-4", { kind: "customer_decision", cycleId: sunita.id, choice: "skip" });
    // A second server with an empty replica picks it up from here.
    (globalThis as unknown as { __pakka: { replicas: Map<string, unknown> } }).__pakka.replicas.clear();
    await clockCommand("SRV-4", { action: "jump", value: DEMO_END });
    const { s } = await replica("SRV-4");
    expect(metrics(s).choiceBreakdown).toEqual({ keep: 52, skip: 140, downgrade: 0, pause: 61, cancel: 47, none: 18 });
    expect(metrics(s).unwantedStopped).toBe(15933400);
  });
});

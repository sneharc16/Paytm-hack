import { describe, expect, it } from "vitest";
import { generateWorld } from "@/engine/world";
import { Session } from "@/engine/session";
import { tick } from "@/engine/agent";
import { run } from "@/engine/gateway";
import { customerDecision, refundAnswer, setKillSwitch, topupConfirmed, verifyPin } from "@/engine/actions";
import { addSec, ist } from "@/engine/clock";
import { failNext } from "@/sim/merchant";

const world = generateWorld("2711");
const owner = (c: { mandateId: string }) => world.mandates.find((m) => m.id === c.mandateId)!;
const sunitaCycle = world.cycles.find((c) => c.group === "ask" && owner(c).userId === "u_sunita")!;
const askCycle = (n: number) => world.cycles.filter((c) => c.group === "ask" && owner(c).userId !== "u_sunita")[n];
const fresh = (to = ist("2026-10-26 21:11")) => { const s = new Session("GW", world); tick(s, to); return s; };

describe("gateway", () => {
  it("RT-01: a double tap on Skip creates one action", () => {
    const s = fresh();
    const a = customerDecision(s, ist("2026-10-26 21:12:40"), sunitaCycle.id, "skip");
    const b = customerDecision(s, addSec(ist("2026-10-26 21:12:40"), 0.2), sunitaCycle.id, "skip");
    expect(a.actionId).toBe("A-5521");
    expect(b.status).toBe("duplicate");
    expect(s.events.filter((e) => e.type === "notice_withdrawn" && e.payload.cycleId === sunitaCycle.id).length).toBe(1);
  });
  it("needs a PIN for pause and cancel, never for skip", () => {
    const s = fresh();
    const c = askCycle(0);
    expect(customerDecision(s, ist("2026-10-26 21:11:30"), c.id, "pause").reason).toBe("PIN_REQUIRED");
    const pin = verifyPin(s, ist("2026-10-26 21:11:31"), owner(c).userId, "1234");
    expect("pinToken" in pin).toBe(true);
    if ("pinToken" in pin) expect(customerDecision(s, ist("2026-10-26 21:11:32"), c.id, "pause", { pinToken: pin.pinToken }).status).toBe("executed");
    expect("error" in verifyPin(s, ist("2026-10-26 21:11:33"), owner(c).userId, "0000")).toBe(true);
  });
  it("RT-03: rejects cancel on an irrevocable mandate", () => {
    const s = fresh();
    const griha = world.mandates.find((m) => m.irrevocable && m.userId === "u_sunita")!;
    const r = run(s, ist("2026-10-26 21:12"), { type: "requestUserOptOut", ruleId: "USER_OPT_OUT_V1", actor: "customer", targetId: griha.id, params: { mandateId: griha.id, kind: "cancel", pinToken: "x" } });
    expect(r.reason).toBe("IRREVOCABLE");
  });
  it("RT-04: kill switch saves the decision, blocks the skip, runs it once on release", () => {
    const s = fresh();
    setKillSwitch(s, ist("2026-10-26 21:11:50"), "global", true, "test");
    const r = customerDecision(s, ist("2026-10-26 21:12"), sunitaCycle.id, "skip");
    expect(r.reason).toBe("KILL_SWITCH_V1");
    expect(s.state.cycle(sunitaCycle.id).decision).toBe("skip");
    setKillSwitch(s, ist("2026-10-26 21:13"), "global", false, "done");
    expect(s.state.cycle(sunitaCycle.id).status).toBe("skipped");
    expect(s.events.filter((e) => e.type === "notice_withdrawn" && e.payload.cycleId === sunitaCycle.id).length).toBe(1);
  });
  it("RT-02: a refund above the cap goes to the merchant queue", () => {
    const s = fresh(ist("2026-10-26 21:00:30"));
    const farhan = world.cycles.find((c) => owner(c).userId === "u_farhan")!;
    refundAnswer(s, ist("2026-10-26 21:00:40"), `ex_${farhan.id}_1`, true);
    expect(s.state.refunds.get(`ex_${farhan.id}_1`)!.status).toBe("with_merchant");
  });
  it("RT-09: two auto refunds that together pass the daily limit: second goes to the queue", () => {
    const s = fresh(ist("2026-10-26 21:00:30"));
    s.state.merchantSettings.get("m_padhoai")!.refundDailyLimit = 59900;
    const auto = world.cycles.filter((c) => c.group === "refund" && c.amount === 59900 && c.dueAt === ist("2026-10-25 23:40")).slice(0, 2);
    for (const c of auto) refundAnswer(s, ist("2026-10-26 21:00:40"), `ex_${c.id}_1`, true);
    expect(auto.map((c) => s.state.refunds.get(`ex_${c.id}_1`)!.status)).toEqual(["sent", "with_merchant"]);
  });
  it("RT-07 and RT-08: retries land off-peak and never past four attempts", () => {
    const s = fresh(ist("2026-10-28 18:04"));
    const rahul = world.cycles.find((c) => c.group === "collect" && c.seq === 2 && owner(c).userId === "u_rahul")!;
    topupConfirmed(s, ist("2026-10-28 18:05"), rahul.id);
    expect(s.state.cycle(rahul.id).retryAt).toBe(ist("2026-10-28 21:41"));
    s.state.cycle(rahul.id).attempts = 4;
    s.state.cycle(rahul.id).status = "failed_business";
    expect(topupConfirmed(s, ist("2026-10-28 18:06"), rahul.id).reason).toBe("RETRY_LIMIT");
  });
  it("RT-14: a decision after the cut-off is recorded but does not skip", () => {
    const s = fresh(ist("2026-10-27 22:59"));
    const c = world.cycles.filter((x) => x.group === "ask" && !world.scripted.find((y) => y.cycleId === x.id)?.answer?.choice.match(/keep|skip|pause|cancel/))[0];
    const r = customerDecision(s, ist("2026-10-27 23:00"), c.id, "skip");
    expect(r.status).toBe("late");
  });
  it("retries a merchant timeout once with the same key", () => {
    const s = fresh();
    failNext("skipCycle", "TIMEOUT");
    customerDecision(s, ist("2026-10-26 21:12"), sunitaCycle.id, "skip");
    expect(s.state.cycle(sunitaCycle.id).status).toBe("skipped");
  });
});

describe("always keep", () => {
  it("scores a kept mandate at 0 and asks nothing", async () => {
    const { setAlwaysKeep } = await import("@/engine/actions");
    const s = new Session("AK", world);
    tick(s, ist("2026-10-26 21:00"));
    const c = world.cycles.find((x) => x.group === "ask" && owner(x).userId !== "u_sunita")!;
    setAlwaysKeep(s, ist("2026-10-26 21:01"), c.mandateId);
    tick(s, ist("2026-10-26 21:11"));
    const score = s.events.find((e) => e.type === "risk_scored" && e.payload.cycleId === c.id)!.payload;
    expect(score.score).toBe(0);
    expect(score.cappedBy).toBe("always_keep");
    expect(s.events.some((e) => e.type === "nudge_sent" && e.payload.cycleId === c.id)).toBe(false);
  });
});

describe("cheaper plan (DOWNGRADE_VIA_MERCHANT_V1)", async () => {
  const { setMerchantSettings } = await import("@/engine/actions");
  const { checkInvariants } = await import("@/engine/invariants");
  const { isPeak, ms: toMs } = await import("@/engine/clock");
  const withOffer = (to: string) => {
    const s = new Session("DG", world);
    tick(s, ist("2026-10-26 21:07"));
    setMerchantSettings(s, ist("2026-10-26 21:07:30"), "m_padhoai", { offerDowngradePlanId: "p_padhoai_lite" }, "Imran Sheikh");
    tick(s, to);
    return s;
  };

  it("charges ₹149 at the original time when there are 24 hours of notice, with no PIN", () => {
    const s = withOffer(ist("2026-10-26 21:11"));
    const r = customerDecision(s, ist("2026-10-26 21:12"), sunitaCycle.id, "downgrade");
    expect(r.status).toBe("executed");
    expect(s.events.some((e) => e.type === "notice_received" && e.payload.fresh && e.payload.amount === 14900)).toBe(true);
    tick(s, ist("2026-10-28 00:00"));
    const charged = s.events.find((e) => e.type === "execution_succeeded" && e.payload.cycleId === sunitaCycle.id)!;
    expect(charged.payload.amount).toBe(14900);
    expect(charged.ruleId).toBe("MANDATE_SCHEDULE_V1");
    expect(s.events.filter((e) => e.type === "execution_attempted" && e.payload.cycleId === sunitaCycle.id)).toHaveLength(1);
    expect(checkInvariants(s)).toEqual([]);
  });

  it("moves the charge to keep 24 hours of notice when the switch comes late", () => {
    const s = withOffer(ist("2026-10-27 21:59"));
    const c = world.cycles.find((x) => x.group === "ask" && world.scripted.find((y) => y.cycleId === x.id)?.answer?.choice === "none")!;
    customerDecision(s, ist("2026-10-27 22:00"), c.id, "downgrade");
    const due = s.state.cycle(c.id).dueOverride!;
    expect(toMs(due) - toMs(ist("2026-10-27 22:00"))).toBeGreaterThanOrEqual(24 * 3_600_000);
    expect(isPeak(new Date(due))).toBe(false);
    tick(s, ist("2026-10-29 06:00"));
    const charges = s.events.filter((e) => e.type === "execution_succeeded" && e.payload.cycleId === c.id);
    expect(charges.map((e) => [e.simAt.slice(0, 16), e.payload.amount])).toEqual([[new Date(toMs(due) + 4000).toISOString().slice(0, 16), 14900]]);
  });

  it("is not offered unless the merchant turned it on", () => {
    const s = fresh();
    expect(customerDecision(s, ist("2026-10-26 21:12"), sunitaCycle.id, "downgrade").reason).toBe("NOT_OFFERED");
  });
});

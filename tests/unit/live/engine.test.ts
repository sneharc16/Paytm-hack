import { describe, expect, it } from "vitest";
import { tick } from "@/engine/agent";
import { applyCommand } from "@/engine/commands";
import { passkeyVerified } from "@/engine/actions";
import { addMonths, AutopayInput, buildLiveWorld, checkAutopay, horizonFrom, type LiveAutopay } from "@/engine/live";
import { Session } from "@/engine/session";
import { checkInvariants } from "@/engine/invariants";
import { pillFor, rowsFor } from "@/lib/views";

const joined = "2026-11-02T06:00:00.000Z"; // 11:30 AM IST
const profile = { id: "lu_test", name: "Meera Rao", lang: "en" as const, startAt: joined };
const ap = (over: Partial<AutopayInput> = {}, id = "ap_one"): LiveAutopay => ({
  ...AutopayInput.parse({ brand: "Readwell", legalName: "Pustak Digital Pvt Ltd", kind: "subscription", amount: 59900, interval: "month", nextDue: "2026-11-05", trial: { amount: 100, startedOn: "2026-10-29" }, ...over }),
  id, addedAt: joined,
});

describe("Pakka live engine", () => {
  it("adds months the way a calendar does", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-05", 3)).toBe("2027-02-05");
  });
  it("refuses a first charge that is already past", () => {
    expect(checkAutopay(ap({ nextDue: "2026-11-01" }), joined)).toBe("NEXT_DUE_IN_PAST");
    expect(checkAutopay(ap(), joined)).toBeNull();
  });
  it("runs a person's own AutoPay on the wall clock: notice, ask, and the charge at 10 PM IST", () => {
    const w = buildLiveWorld(profile, [ap()], horizonFrom(joined));
    expect(w.cycles.map((c) => c.dueAt)).toEqual(["2026-11-05T16:30:00.000Z", "2026-12-05T16:30:00.000Z"]);
    const s = new Session(profile.id, w);
    tick(s, "2026-11-04T17:00:00.000Z"); // past the notice
    const c1 = s.state.cycle("ap_one_c1");
    expect(c1.status).toBe("awaiting_answer"); // trial ₹1 to ₹599 and a first charge: Pakka asks
    expect(s.state.nudges.at(-1)?.kind).toBe("ask");
    tick(s, "2026-11-05T17:00:00.000Z");
    expect(s.state.cycle("ap_one_c1").status).toBe("succeeded"); // silence: the charge goes ahead (simulated money)
    expect(checkInvariants(s)).toEqual([]);
  });
  it("skips for 1 month with the passkey-backed token, then cancels on a second pause", () => {
    const s = new Session(profile.id, buildLiveWorld(profile, [ap()], horizonFrom(joined)));
    tick(s, "2026-11-04T17:00:00.000Z");
    const at = "2026-11-04T17:00:00.000Z";
    expect((applyCommand(s, at, { kind: "customer_decision", cycleId: "ap_one_c1", choice: "pause" }) as { status: string }).status).not.toBe("done");
    expect(s.state.mandateStatus.get("ap_one")).toBe("active");
    const { pinToken } = passkeyVerified(s, at, profile.id, "pk_token_1");
    applyCommand(s, at, { kind: "customer_decision", cycleId: "ap_one_c1", choice: "pause", pinToken });
    expect(s.state.mandateStatus.get("ap_one")).toBe("active");
    expect(s.state.skipsUsed("ap_one")).toBe(1);
    expect(s.state.cycle("ap_one_c2").status).toBe("scheduled");
    tick(s, "2026-11-06T00:00:00.000Z");
    expect(s.state.executions.size).toBe(0);

    // Pausing a second time (after reaching maxSkipsAllowed = 1) cancels the mandate
    const { pinToken: pinToken2 } = passkeyVerified(s, "2026-11-06T00:00:00.000Z", profile.id, "pk_token_2");
    applyCommand(s, "2026-11-06T00:00:00.000Z", { kind: "customer_decision", cycleId: "ap_one_c2", choice: "pause", pinToken: pinToken2 });
    expect(s.state.mandateStatus.get("ap_one")).toBe("revoked");
    expect(pillFor(rowsFor(s, profile.id)[0])).toEqual({ kind: "muted", key: "pill.cancelled" });
  });
  it("keeps an EMI as remind-only", () => {
    const s = new Session(profile.id, buildLiveWorld(profile, [ap({ kind: "emi", trial: null, brand: "Ghar Loan" }, "ap_emi")], horizonFrom(joined)));
    tick(s, "2026-11-05T17:00:00.000Z");
    expect(s.state.nudges.map((n) => n.kind)).toContain("remind");
    expect(s.state.cycle("ap_emi_c1").status).toBe("succeeded");
  });
});

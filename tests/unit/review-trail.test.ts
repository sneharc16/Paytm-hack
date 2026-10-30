import { describe, expect, it } from "vitest";
import { askQuestion } from "@/engine/actions";
import { tick } from "@/engine/agent";
import { ist } from "@/engine/clock";
import { Session } from "@/engine/session";
import { generateWorld } from "@/engine/world";
import { recorderRow, reviewCounts } from "@/lib/recorder";

describe("privacy in the event log and the review counters", () => {
  const s = new Session("TRAIL", generateWorld("2711"));
  tick(s, ist("2026-10-26 21:11"));

  it("stores the customer's question masked, with counts only", () => {
    askQuestion(s, ist("2026-10-26 21:12"), "u_rahul", "Rahul Mehra here, call 9876543210 or rahul@okaxis, OTP 4821. ye ₹599 kya hai?");
    const asked = s.events.findLast((e) => e.type === "question_asked")!;
    const all = JSON.stringify(s.events.slice(-3));
    for (const v of ["9876543210", "rahul@okaxis", "4821", "Rahul Mehra"]) expect(all).not.toContain(v);
    expect(asked.payload.text).toContain("₹599");
    expect(asked.payload.masked).toMatchObject({ PHONE: 1, UPI: 1, SECRET: 1, NAME: 1 });
    expect(recorderRow(s, asked)?.detail).toBe("4 masked: phone, UPI ID, OTP or PIN, name before any model saw it");
  });

  it("counts every model-eligible message once, as checked or as template", () => {
    const c = reviewCounts(s.events);
    const eligible = s.events.filter((e) => e.type === "nudge_sent" && ["ask", "tell", "follow_up", "collect", "remind"].includes(e.payload.kind)).length;
    expect(c.checked + c.template).toBeGreaterThanOrEqual(eligible);
    expect(c.avgRounds).toBeLessThanOrEqual(5);
  });
});

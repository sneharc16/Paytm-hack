import { describe, expect, it } from "vitest";
import { codeChecks } from "@/llm/agents/checks";
import { reviewLoop, type Caller, type Role } from "@/llm/agents/loop";
import { criteriaFor, RUBRIC, rubricText } from "@/llm/agents/rubric";

const METRICS = { brand: "VidyaKosh", count: 24, consent: 18, name: 3, ownership: 2, trial_amount: "₹1", amount: "₹599" };
const GOOD = { headline: "24 reviews mention your ₹1 trial and AutoPay", detail: "Only you and Paytm's merchant team can see this. 18 of them did not expect a ₹599 charge." };
const INVENTED = { ...GOOD, detail: "Only you and Paytm's merchant team can see this. 18 of them did not expect a ₹999 charge." };
const PUSHY = { ...GOOD, headline: "24 reviews: act now on your ₹1 trial" };

const ALERT_IDS = criteriaFor("alert").map((c) => c.id);
const allPass = () => ({ verdicts: ALERT_IDS.map((criterion) => ({ criterion, verdict: "pass", quote: "", fix: "" })), contest_answers: [], binding: null });
const failOn = (id: string, quote: string, binding: unknown = null) => ({
  verdicts: ALERT_IDS.map((criterion) => (criterion === id ? { criterion, verdict: "fail", quote, fix: `Remove "${quote}"` } : { criterion, verdict: "pass", quote: "", fix: "" })),
  contest_answers: [], binding,
});

/** A scripted model: each role answers from its own queue (the last answer repeats). */
function scripted(script: Partial<Record<Role, unknown[]>>) {
  const seen: { role: Role; user: string }[] = [];
  const call: Caller = async (role, _system, user) => {
    seen.push({ role, user });
    const q = script[role] ?? [];
    const n = seen.filter((x) => x.role === role).length - 1;
    return { ok: true, raw: q[Math.min(n, q.length - 1)], model: `fake-${role}` };
  };
  return { call, seen };
}
const gen = (draft: unknown, contests: unknown[] = []) => ({ draft, contests });

describe("rubric", () => {
  it("is one list with unique IDs, and every task gets the shared criteria", () => {
    expect(new Set(RUBRIC.map((c) => c.id)).size).toBe(RUBRIC.length);
    for (const t of ["reminder", "intake", "case_summary", "alert"] as const) {
      for (const id of ["R1", "R2", "R6", "R7", "R8", "R9"]) expect(criteriaFor(t).map((c) => c.id)).toContain(id);
      expect(rubricText(t)).toContain("R1 Facts only");
    }
    expect(criteriaFor("case_summary").map((c) => c.id)).toContain("L4-S");
    expect(criteriaFor("alert").map((c) => c.id)).toContain("L6-P");
  });

  it("code checks catch invented numbers, missing lines, length and PII", () => {
    expect(Object.values(codeChecks("alert", METRICS, GOOD)).every((c) => c.pass)).toBe(true);
    expect(codeChecks("alert", METRICS, INVENTED).R1.pass).toBe(false);
    expect(codeChecks("alert", METRICS, { ...GOOD, detail: "18 of them did not expect a ₹599 charge." })["L6-P"].pass).toBe(false);
    expect(codeChecks("alert", METRICS, { ...GOOD, headline: "x".repeat(91) }).R7.pass).toBe(false);
    expect(codeChecks("alert", METRICS, { ...GOOD, detail: `${GOOD.detail} Call 9876543210.` }).R9.pass).toBe(false);
  });
});

describe("three-agent review loop", () => {
  it("agrees in round 1", async () => {
    const { call, seen } = scripted({ generator: [gen(GOOD)], reviewer: [allPass()] });
    const r = await reviewLoop("alert", METRICS, { call });
    expect(r.meta).toMatchObject({ status: "agreed", rounds: 1, calls: 2 });
    expect(r.output).toEqual(GOOD);
    expect(seen.map((x) => x.role)).toEqual(["generator", "reviewer"]);
  });

  it("agrees in round 3 after the generator fixes what the reviewer failed", async () => {
    const { call, seen } = scripted({ generator: [gen(PUSHY), gen(PUSHY), gen(GOOD)], reviewer: [failOn("L6-P", "act now"), failOn("L6-P", "act now"), allPass()] });
    const r = await reviewLoop("alert", METRICS, { call });
    expect(r.meta).toMatchObject({ status: "agreed", rounds: 3 });
    expect(r.output).toEqual(GOOD);
    expect(r.meta.trail[0].fails).toEqual([{ criterion: "L6-P", by: "reviewer", quote: "act now", fix: 'Remove "act now"' }]);
    // The generator saw the review in round 2.
    expect(seen[2].user).toContain("REVIEW");
    expect(seen[2].user).toContain("act now");
  });

  it("stops at round 5 and the reviewer's binding decision wins", async () => {
    const binding = { use_template: false, remove: [], change: [{ from: "act now on your", to: "mention your" }], include: [] };
    const { call, seen } = scripted({
      generator: [gen(PUSHY)],
      reviewer: [failOn("L6-P", "act now"), failOn("L6-P", "act now"), failOn("L6-P", "act now"), failOn("L6-P", "act now"), failOn("L6-P", "act now", binding)],
      consolidator: [{ headline: "24 reviews: mention your ₹1 trial", detail: GOOD.detail }],
    });
    const r = await reviewLoop("alert", METRICS, { call });
    expect(r.meta).toMatchObject({ status: "reviewer_final", rounds: 5, calls: 11 });
    expect(r.meta.binding).toEqual(binding);
    expect(r.output?.headline).toBe("24 reviews: mention your ₹1 trial");
    expect(seen.filter((x) => x.role === "reviewer")[4].user).toContain("FINAL ROUND: yes");
  });

  it("uses the template when the reviewer says so", async () => {
    const { call } = scripted({ generator: [gen(PUSHY)], reviewer: [failOn("L6-P", "act now", { use_template: true, remove: [], change: [], include: [] })] });
    const r = await reviewLoop("alert", METRICS, { call });
    expect(r.meta).toMatchObject({ status: "template", rounds: 5, reason: "reviewer_use_template" });
    expect(r.output).toBeNull();
  });

  it("uses the template when the consolidator brings back what the reviewer removed", async () => {
    const binding = { use_template: false, remove: ["act now"], change: [], include: [] };
    const { call } = scripted({ generator: [gen(PUSHY)], reviewer: [failOn("L6-P", "act now", binding)], consolidator: [PUSHY] });
    const r = await reviewLoop("alert", METRICS, { call });
    expect(r.meta.status).toBe("template");
    expect(r.meta.reason).toContain('kept "act now"');
  });

  it("uses the template when the final text fails the fact-check", async () => {
    // The consolidator invents an amount: the final gate catches it.
    const binding = { use_template: false, remove: ["act now"], change: [], include: [] };
    const { call } = scripted({ generator: [gen(PUSHY)], reviewer: [failOn("L6-P", "act now", binding)], consolidator: [{ headline: "24 reviews mention your ₹1 trial", detail: INVENTED.detail }] });
    const r = await reviewLoop("alert", METRICS, { call });
    expect(r.meta.status).toBe("template");
    expect(r.meta.reason).toMatch(/^final_check:R1/);
  });

  it("does not let a reviewer pass a criterion a code check failed", async () => {
    const { call } = scripted({ generator: [gen(INVENTED)], reviewer: [allPass()] });
    const r = await reviewLoop("alert", METRICS, { call, maxRounds: 2 });
    expect(r.meta.status).toBe("template");
    expect(r.meta.trail[0].verdicts.R1).toBe("fail");
    expect(r.meta.trail[0].fails[0]).toMatchObject({ criterion: "R1", by: "code" });
  });

  it("withdraws a fail only when the contest quotes FACTS", async () => {
    const real = { verdicts: ALERT_IDS.map((criterion) => (criterion === "R8" ? { criterion, verdict: "fail", quote: "AutoPay", fix: "Avoid jargon" } : { criterion, verdict: "pass", quote: "", fix: "" })), contest_answers: [{ criterion: "R8", answer: "withdrawn", reason: "The facts use the word" }], binding: null };
    const ok = await reviewLoop("alert", METRICS, { call: scripted({ generator: [gen(GOOD, [{ criterion: "R8", facts_quote: "₹599" }])], reviewer: [real] }).call });
    expect(ok.meta.status).toBe("agreed");
    expect(ok.meta.trail[0].contests[0]).toMatchObject({ criterion: "R8", answer: "withdrawn" });
    const bad = await reviewLoop("alert", METRICS, { call: scripted({ generator: [gen(GOOD, [{ criterion: "R8", facts_quote: "made up line" }])], reviewer: [real] }).call, maxRounds: 1 });
    expect(bad.meta.trail[0].contests[0]).toMatchObject({ answer: "upheld", reason: "Quote is not in FACTS" });
  });

  it("stops on the time budget and on model failures", async () => {
    let t = 0;
    const { call } = scripted({ generator: [gen(PUSHY)], reviewer: [failOn("L6-P", "act now")] });
    const r = await reviewLoop("alert", METRICS, { call: async (...a) => { t += 5000; return call(...a); }, deadline: 12_000, now: () => t });
    expect(r.meta).toMatchObject({ status: "template", reason: "time_budget" });
    const down: Caller = async () => ({ ok: false, reason: "rate_limited" });
    expect((await reviewLoop("alert", METRICS, { call: down })).meta).toMatchObject({ status: "template", reason: "generator_rate_limited" });
  });

  it("never runs more than 5 rounds", async () => {
    const { call, seen } = scripted({ generator: [gen(PUSHY)], reviewer: [failOn("L6-P", "act now")] });
    const r = await reviewLoop("alert", METRICS, { call });
    expect(r.meta.rounds).toBe(5);
    expect(seen.filter((x) => x.role === "generator")).toHaveLength(5);
    expect(r.meta.reason).toBe("reviewer_no_binding");
  });
});

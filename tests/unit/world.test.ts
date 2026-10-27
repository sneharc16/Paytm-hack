import { describe, expect, it } from "vitest";
import { generateWorld, DEMO } from "@/engine/world";
import { isPeak, ist, ms } from "@/engine/clock";

const w = generateWorld("2711");
const byGroup = (g: string) => w.cycles.filter((c) => c.group === g);
const mandate = new Map(w.mandates.map((m) => [m.id, m]));
const user = new Map(w.users.map((u) => [u.id, u]));

describe("world seed 2711", () => {
  it("has the exact headline counts", () => {
    expect(w.users.length).toBe(6000);
    expect(w.merchants.length).toBe(14);
    expect(w.mandates.length).toBe(9400);
    expect(w.mandates.filter((m) => m.merchantId === "m_padhoai").length).toBe(1300);
    expect(w.reviews.length).toBeGreaterThan(2900);
    expect(w.reviews.length).toBeLessThan(3100);
  });
  it("gives every user 1 to 4 mandates, never two from one merchant", () => {
    const per = new Map<string, string[]>();
    for (const m of w.mandates) per.set(m.userId, [...(per.get(m.userId) ?? []), m.merchantId]);
    expect(per.size).toBe(6000);
    for (const ms_ of per.values()) {
      expect(ms_.length).toBeGreaterThanOrEqual(1);
      expect(ms_.length).toBeLessThanOrEqual(4);
      expect(new Set(ms_).size).toBe(ms_.length);
    }
  });
  it("matches the PadhoAI groups in 10.4", () => {
    const ask = byGroup("ask");
    expect(ask.length).toBe(318);
    expect(byGroup("confirmed").length).toBe(92);
    expect(ask.filter((c) => mandate.get(c.mandateId)!.usageConsent).length).toBe(271);
    const langs = { hi: 0, hinglish: 0, en: 0 };
    for (const c of ask) langs[user.get(mandate.get(c.mandateId)!.userId)!.lang]++;
    expect(langs).toEqual({ hi: 142, hinglish: 131, en: 45 });
    const answers: Record<string, number> = {};
    for (const s of w.scripted) if (s.answer) answers[s.answer.choice] = (answers[s.answer.choice] ?? 0) + 1;
    expect(answers).toEqual({ keep: 52, skip: 140, pause: 61, cancel: 47, none: 18 });
    for (const s of w.scripted) if (s.answer) expect(ms(s.answer.at)).toBeLessThan(ms(ist("2026-10-27 22:40")));
    expect(ask.every((c) => c.dueAt === DEMO.askDue)).toBe(true);
  });
  it("matches the refund lane in 10.5 and collect lane in 10.6", () => {
    expect(byGroup("refund").length).toBe(27);
    expect(byGroup("collect").filter((c) => c.seq === 2).length).toBe(260);
    const outcomes = { first: 0, retry: 0, none: 0 };
    for (const s of w.scripted) {
      if (!s.executionResults) continue;
      if (s.executionResults.length === 1) outcomes.first++;
      else if (s.executionResults[1] === "success") outcomes.retry++;
      else outcomes.none++;
    }
    expect(outcomes).toEqual({ first: 150, retry: 34, none: 76 });
  });
  it("seeds the review spike in 10.7", () => {
    const spike = w.reviews.filter((r) => r.merchantId === "m_padhoai" && r.rating <= 2
      && ms(r.postedAt) > ms(ist("2026-10-26 14:58")) && ms(r.postedAt) <= ms(ist("2026-10-26 20:58")));
    expect(spike.length).toBe(46);
    const g: Record<string, number> = {};
    for (const r of spike) g[r.goldGap!] = (g[r.goldGap!] ?? 0) + 1;
    expect(g).toEqual({ consent: 38, name: 6, ownership: 2 });
    expect(w.reviews.every((r) => /^[A-Z]\. [A-Z]\.$/.test(r.author))).toBe(true);
  });
  it("never schedules a cycle in a peak window", () => {
    expect(w.cycles.filter((c) => isPeak(new Date(c.dueAt)))).toEqual([]);
  });
  it("is deterministic and fast", () => {
    const t = performance.now();
    const again = generateWorld("2711");
    expect(performance.now() - t).toBeLessThan(300);
    expect(again.mandates[1234]).toEqual(w.mandates[1234]);
    expect(again.scripted[200]).toEqual(w.scripted[200]);
  });
});

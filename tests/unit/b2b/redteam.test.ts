import { describe, expect, it } from "vitest";
import { RED_TEAM_B2B } from "@/b2b/redteam";
import { generateBusinessWorld } from "@/b2b/world";

const world = generateBusinessWorld("2711");
describe("business red team", () => {
  it("has 34 cases with unique ids", () => {
    expect(RED_TEAM_B2B).toHaveLength(34);
    expect(new Set(RED_TEAM_B2B.map((c) => c.id)).size).toBe(34);
  });
  for (const c of RED_TEAM_B2B) {
    it(`${c.id} ${c.title}`, () => {
      const r = c.run(world);
      expect(r.moneyMoved, r.observed.join(" | ")).toBe(false);
      expect(r.passed, r.observed.join(" | ")).toBe(true);
    });
  }
});

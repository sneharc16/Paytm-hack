import { describe, expect, it } from "vitest";
import { RED_TEAM } from "@/engine/redteam";
import { generateWorld } from "@/engine/world";

const world = generateWorld("2711");
describe("red-team panel (PRD 29.2)", () => {
  it("has all fourteen cases", () => expect(RED_TEAM.map((c) => c.id)).toEqual(Array.from({ length: 14 }, (_, i) => `RT-${String(i + 1).padStart(2, "0")}`)));
  for (const c of RED_TEAM) {
    it(`${c.id} ${c.title}`, () => {
      const r = c.run(world);
      expect(r.passed, r.observed.join(" | ")).toBe(true);
    });
  }
});

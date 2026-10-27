import { expect, it } from "vitest";
import { hasNameGap } from "@/engine/namegap";

it("finds name gaps exactly as PRD 11.3", () => {
  expect(hasNameGap("PadhoAI", "Vidyakosh Learning Pvt Ltd")).toBe(true);
  expect(hasNameGap("Griha Home Finance", "Griha Home Finance Ltd")).toBe(false);
  expect(hasNameGap("StadiumPass", "Khelghar Media Pvt Ltd")).toBe(true);
  expect(hasNameGap("Nivesh SIP", "Nivesh Asset Management Ltd")).toBe(false);
});

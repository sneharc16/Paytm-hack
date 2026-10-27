import { expect, it } from "vitest";
import { generateWorld } from "@/engine/world";
import { Session } from "@/engine/session";
import { tick } from "@/engine/agent";
import { DEMO_END } from "@/engine/clock";

it("keeps the full demo log small enough to ship to a phone", () => {
  const s = new Session("SZ", generateWorld("2711"));
  const t = performance.now();
  tick(s, DEMO_END);
  const elapsed = performance.now() - t;
  const bytes = JSON.stringify(s.events).length;
  expect(s.events.length).toBeLessThan(40000);
  expect(bytes).toBeLessThan(15_000_000);
  expect(elapsed).toBeLessThan(3000);
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../src/b2b");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
const src = files(root).filter((f) => f.endsWith(".ts")).map((f) => ({ f: path.relative(root, f), text: readFileSync(f, "utf8") }));

describe("business engine boundaries", () => {
  it("the guard can verify but never sign", () => {
    const guard = src.find((x) => x.f === "guard.ts")!.text;
    expect(guard).not.toMatch(/from "\.\/keys"/);
    expect(guard).not.toMatch(/ed25519\.sign|secretKey/);
  });
  it("only the guard talks to the bank's payout", () => {
    for (const x of src) if (x.f !== "guard.ts" && x.f !== "sim/bank.ts") expect(x.text, x.f).not.toMatch(/\bsubmit\(/);
  });
  it("is pure: no React, Next, Math.random or wall clock", () => {
    for (const x of src) {
      expect(x.text, x.f).not.toMatch(/from "react"|from "next/);
      expect(x.text, x.f).not.toMatch(/Math\.random|Date\.now\(\)|new Date\(\)/);
    }
  });
  it("does not change the consumer engine: imports from src/engine are read-only helpers", () => {
    for (const x of src) for (const m of x.text.matchAll(/from "@\/engine\/([^"]+)"/g)) expect(["clock"], x.f).toContain(m[1]);
  });
  it("has no em or en dashes in any string", () => {
    for (const x of src) expect(/[–—]/.test(x.text), x.f).toBe(false);
  });
});

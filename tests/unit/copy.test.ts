import { describe, expect, it } from "vitest";
import { STRINGS } from "@/copy/strings";
import { bannedWordsIn } from "@/copy/banned";

describe("copy deck", () => {
  const rows = Object.entries(STRINGS);
  it("has all three languages for every key", () => {
    for (const [k, r] of rows) for (const l of ["hi", "hinglish", "en"] as const) expect(r[l], `${k}.${l}`).toBeTruthy();
  });
  it("has no banned words outside fraud.*", () => {
    for (const [k, r] of rows) {
      if (k.startsWith("fraud.")) continue;
      for (const v of Object.values(r)) expect(bannedWordsIn(v), `${k}: ${v}`).toEqual([]);
    }
  });
  it("has no em dash or en dash", () => {
    for (const [k, r] of rows) for (const v of Object.values(r)) expect(/[–—]/.test(v), k).toBe(false);
  });
  it("keeps Hindi in Devanagari", () => {
    expect(/[ऀ-ॿ]/.test(STRINGS["sheet.question"].hi)).toBe(true);
  });
});

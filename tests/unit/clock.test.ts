import { describe, expect, it } from "vitest";
import { ist, isPeak, nextOffPeak } from "@/engine/clock";

const at = (hm: string) => new Date(ist(`2026-10-28 ${hm}`));

describe("peak windows 10:00-13:00 and 17:00-21:30 IST", () => {
  it.each([
    ["9:59", false, "9:59"], ["10:00", true, "13:00"], ["12:59", true, "13:00"], ["13:00", false, "13:00"],
    ["16:59", false, "16:59"], ["17:00", true, "21:30"], ["21:29", true, "21:30"], ["21:30", false, "21:30"],
  ])("%s", (hm, peak, next) => {
    expect(isPeak(at(hm))).toBe(peak);
    expect(nextOffPeak(at(hm)).toISOString()).toBe(at(next).toISOString());
  });
  it("puts Rahul's 6:05 PM top-up at 9:30 PM", () => {
    expect(nextOffPeak(at("18:05")).toISOString()).toBe(at("21:30").toISOString());
  });
});

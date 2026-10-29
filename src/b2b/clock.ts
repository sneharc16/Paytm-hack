// src/b2b/clock.ts: the business demo window and the payout release window. Reuses the B2C clock helpers
// (read only; nothing in src/engine changes).
import { addMin, ist, istMinutes, ms } from "@/engine/clock";
import type { ISO } from "./types";

export const B2B_START: ISO = ist("2026-10-26 08:30"); // Mon 26 Oct 2026, 8:30 AM IST
export const B2B_END: ISO = ist("2026-10-28 20:00"); // Wed 28 Oct 2026, 8:00 PM IST

/** Payouts leave only between these IST minutes. A payout planned at 2 AM is a fraud signal in most finance
 *  teams, and a person is around to answer the bank if something goes wrong. */
export function inReleaseWindow(at: ISO, startMin: number, endMin: number): boolean {
  const m = istMinutes(new Date(at));
  return m >= startMin && m < endMin;
}

export function nextReleaseOpen(at: ISO, startMin: number, endMin: number): ISO {
  if (inReleaseWindow(at, startMin, endMin)) return at;
  const m = istMinutes(new Date(at));
  const base = ms(at) - (ms(at) % 60_000);
  const delta = m < startMin ? startMin - m : 1440 - m + startMin;
  return new Date(base + delta * 60_000).toISOString();
}

/** The next 00:00 IST strictly after `at`. */
export function nextIstMidnight(at: ISO): ISO {
  const m = istMinutes(new Date(at));
  const base = ms(at) - (ms(at) % 60_000);
  return new Date(base + (1440 - m) * 60_000).toISOString();
}

export const hoursBetween = (a: ISO, b: ISO) => (ms(b) - ms(a)) / 3_600_000;
export const daysBetween = (a: ISO, b: ISO) => Math.floor((ms(b) - ms(a)) / 86_400_000);

export const B2B_MOMENTS: { at: ISO; label: string }[] = [
  { at: ist("2026-10-26 09:05"), label: "Morning invoice run" },
  { at: ist("2026-10-26 11:25"), label: "Bank change email arrives" },
  { at: ist("2026-10-26 12:10"), label: "Callback to the number on file" },
  { at: ist("2026-10-26 15:00"), label: "Large payments wait for people" },
  { at: ist("2026-10-26 19:30"), label: "Release window closes" },
  { at: ist("2026-10-27 09:05"), label: "Next morning run" },
  { at: ist("2026-10-27 11:30"), label: "New vendor out of cooling" },
  { at: ist("2026-10-28 12:00"), label: "Limit increase goes live" },
  { at: B2B_END, label: "End" },
];

export { addMin, ist, ms };

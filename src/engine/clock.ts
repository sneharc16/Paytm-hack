// src/engine/clock.ts (PRD 25.1)
import type { ISO } from "./types";

export const IST_OFFSET_MIN = 330; // India has no daylight saving
export const SESSION_START: ISO = "2026-10-26T15:25:00.000Z"; // Mon 26 Oct 2026, 8:55 PM IST
export const DEMO_END: ISO = "2026-10-29T00:30:00.000Z"; // Thu 29 Oct 2026, 6:00 AM IST

export interface ClockState { simAnchor: ISO; realAnchor: number; speed: 60 | 600 | 3600; paused: boolean }

// speed = sim seconds per real second. 60 means 1 real second = 1 sim minute.
export function simNow(c: ClockState, realNowMs: number): Date {
  if (c.paused) return new Date(c.simAnchor);
  return new Date(new Date(c.simAnchor).getTime() + (realNowMs - c.realAnchor) * c.speed);
}

/** Minutes since IST midnight. */
export function istMinutes(t: Date): number {
  const m = Math.floor(t.getTime() / 60_000) + IST_OFFSET_MIN;
  return ((m % 1440) + 1440) % 1440;
}

export function isPeak(t: Date): boolean {
  const m = istMinutes(t);
  return (m >= 600 && m < 780) || (m >= 1020 && m < 1290); // 10:00-13:00, 17:00-21:30
}

/** First instant at or after t that is not peak. */
export function nextOffPeak(t: Date): Date {
  const m = istMinutes(t);
  const startOfMinute = t.getTime() - (t.getTime() % 60_000);
  if (m >= 600 && m < 780) return new Date(startOfMinute + (780 - m) * 60_000);
  if (m >= 1020 && m < 1290) return new Date(startOfMinute + (1290 - m) * 60_000);
  return t;
}

/** Which peak window t falls in, for the "why" note. */
export function peakWindow(t: Date): "morning" | "evening" | null {
  const m = istMinutes(t);
  if (m >= 600 && m < 780) return "morning";
  if (m >= 1020 && m < 1290) return "evening";
  return null;
}

/** Build a UTC ISO from an IST wall-clock time. ist("2026-10-26 21:10") */
export function ist(s: string): ISO {
  const [d, hm = "00:00"] = s.split(" ");
  const [h, mi, se = "0"] = hm.split(":");
  const [y, mo, da] = d.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, da, Number(h), Number(mi), Number(se)) - IST_OFFSET_MIN * 60_000).toISOString();
}

export const addMin = (iso: ISO, min: number): ISO => new Date(new Date(iso).getTime() + min * 60_000).toISOString();
export const addSec = (iso: ISO, s: number): ISO => new Date(new Date(iso).getTime() + s * 1000).toISOString();
export const ms = (iso: ISO) => new Date(iso).getTime();

/** IST calendar day key, "2026-10-26". */
export function istDay(iso: ISO): string {
  return new Date(ms(iso) + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Quiet hours for pushes: 10:30 PM to 7:30 AM IST. */
export function isQuiet(t: Date): boolean {
  const m = istMinutes(t);
  return m >= 1350 || m < 450;
}

/** Next 7:30 AM IST at or after t. */
export function nextMorning(t: Date): Date {
  const m = istMinutes(t);
  const base = t.getTime() - (t.getTime() % 60_000);
  const delta = m < 450 ? 450 - m : 1440 - m + 450;
  return new Date(base + delta * 60_000);
}

/** The marked moments the demo clock can jump to (PRD 10.1). */
export const MOMENTS: { at: ISO; label: string }[] = [
  { at: ist("2026-10-26 20:58"), label: "Incident opens" },
  { at: ist("2026-10-26 21:06"), label: "Merchant turns on Doosri Haan" },
  { at: ist("2026-10-26 21:10"), label: "Notices and reminders" },
  { at: ist("2026-10-27 21:30"), label: "Off-peak opens" },
  { at: ist("2026-10-27 23:40"), label: "Charges" },
  { at: ist("2026-10-28 18:05"), label: "Rahul tops up" },
  { at: ist("2026-10-28 21:41"), label: "Rahul's retry" },
  { at: DEMO_END, label: "End" },
];

// Deterministic checks on model output (PRD 14.3). If any fails, the template is used instead.
import { bannedWordsIn } from "@/copy/banned";

const DEV_DIGITS = "०१२३४५६७८९";
const toAscii = (s: string) => s.replace(/[०-९]/g, (d) => String(DEV_DIGITS.indexOf(d)));
export const numbersIn = (s: string) => (toAscii(s).replace(/(\d),(?=\d)/g, "$1").match(/\d+/g) ?? []).map(Number);

function factNumbers(facts: unknown): Set<number> {
  const out = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === "number") out.add(v);
    else if (typeof v === "string") numbersIn(v).forEach((n) => out.add(n));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

const formatInr = (rupees: number) => `₹${new Intl.NumberFormat("en-IN").format(rupees)}`;

export interface ReminderFactsLike { language: string; brand: string; amount_rupees: number }
export interface ReminderOutLike { title: string; body: string; voice_script: string; language: string }

/** Returns the reasons the output failed, or [] when it passes. */
export function factcheckReminder(facts: ReminderFactsLike, out: ReminderOutLike): string[] {
  const fail: string[] = [];
  const all = `${out.title}\n${out.body}\n${out.voice_script}`;
  if (!out.title.includes(facts.brand)) fail.push("title_missing_brand");
  if (!out.title.includes(formatInr(facts.amount_rupees))) fail.push("title_missing_amount");
  const allowed = factNumbers(facts);
  const extra = numbersIn(all).filter((n) => !allowed.has(n));
  if (extra.length) fail.push(`unknown_numbers:${[...new Set(extra)].join(",")}`);
  const banned = bannedWordsIn(all);
  if (banned.length) fail.push(`banned:${banned.join(",")}`);
  const letters = all.match(/\p{L}/gu) ?? [];
  const dev = letters.filter((c) => /[ऀ-ॿ]/.test(c)).length;
  const share = letters.length ? dev / letters.length : 0;
  if (facts.language === "hi" && share < 0.6) fail.push("script_not_devanagari");
  if (facts.language !== "hi" && share >= 0.05) fail.push("script_not_latin");
  if (out.language !== facts.language) fail.push("wrong_language");
  if (out.title.length > 60 || out.body.length > 160 || out.voice_script.length > 450) fail.push("too_long");
  return fail;
}

/** L6: numbers only from the metrics, and the privacy line is present. */
export function factcheckAlert(metrics: Record<string, unknown>, out: { headline: string; detail: string }): string[] {
  const fail: string[] = [];
  const allowed = factNumbers(metrics);
  const extra = numbersIn(`${out.headline} ${out.detail}`).filter((n) => !allowed.has(n));
  if (extra.length) fail.push(`unknown_numbers:${extra.join(",")}`);
  if (!out.detail.includes("Only you and Paytm's merchant team can see this.")) fail.push("missing_privacy_line");
  if (out.headline.length > 90 || out.detail.length > 200) fail.push("too_long");
  return fail;
}

/** L4: no numbers the facts don't contain. */
export function factcheckSummary(facts: unknown, out: unknown): string[] {
  const allowed = factNumbers(facts);
  const extra = numbersIn(JSON.stringify(out)).filter((n) => !allowed.has(n));
  return extra.length ? [`unknown_numbers:${[...new Set(extra)].join(",")}`] : [];
}

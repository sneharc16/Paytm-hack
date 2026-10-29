// src/copy/regional.ts: customer copy in regional languages. Every line is machine-translated by Sarvam from the
// hand-written English in strings.ts, then fact-checked here before it can be shown: placeholders and numbers must
// survive exactly, the text must be in the right script, and no dashes. A line that fails stays in the base
// language. Baked lines (regional.json, `pnpm bake:sarvam`) are used first; others can be fetched at run time.
import { dayMonth, relativeDay } from "@/lib/format";
import { STRINGS, t, type StringKey } from "./strings";
import { baseLang, isRegional, langInfo, type RegionalCode, type UiLang } from "./languages";
import baked from "./regional.json";

export type Table = Partial<Record<StringKey | ExtraKey, string>>;

/** Words the date helpers produce, translated alongside the deck. */
export const EXTRA = { "rel.today": "Today", "rel.tomorrow": "Tomorrow", "rel.dayafter": "Day after tomorrow", "voice.hindi": "Voice in Hindi" } as const;
export type ExtraKey = keyof typeof EXTRA;

const tables = new Map<RegionalCode, Table>(Object.entries((baked as { langs?: Record<string, Table> }).langs ?? {}) as [RegionalCode, Table][]);
export const hasTable = (lang: RegionalCode) => tables.has(lang) && Object.keys(tables.get(lang)!).length > 0;
export const setTable = (lang: RegionalCode, table: Table) => tables.set(lang, { ...(tables.get(lang) ?? {}), ...table });
export const getTable = (lang: RegionalCode) => tables.get(lang) ?? {};
export const bakedLanguages = () => [...tables.keys()];

/** The English source of every line to translate. */
export function sourceLines(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, row] of Object.entries(STRINGS)) out[k] = row.en;
  for (const [k, v] of Object.entries(EXTRA)) out[k] = v;
  return out;
}

const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
const numbers = (s: string) => (s.replace(/\{[a-zA-Z]+\}/g, "").match(/\d+/g) ?? []).sort();

/** Remove characters the copy rules forbid, without changing meaning. */
export const tidy = (s: string) => s.replace(/\s*[–—]\s*/g, ", ").replace(/\s+/g, " ").trim();

export interface Check { ok: boolean; text: string; problems: string[] }
export function checkTranslation(source: string, raw: string, lang: UiLang): Check {
  const text = tidy(raw ?? "");
  const problems: string[] = [];
  if (!text) problems.push("empty");
  if (placeholders(source).join() !== placeholders(text).join()) problems.push("placeholders");
  if (numbers(source).join() !== numbers(text).join()) problems.push("numbers");
  const letters = source.replace(/\{[a-zA-Z]+\}/g, "").replace(/[^A-Za-z]/g, "");
  if (letters.length > 2 && !langInfo(lang).script.test(text.replace(/\{[a-zA-Z]+\}/g, ""))) problems.push("script");
  if (text.length > source.length * 4 + 40) problems.push("too_long");
  if (/[<>]|https?:/i.test(text)) problems.push("markup");
  return { ok: problems.length === 0, text, problems };
}

/** t() for any language: hand-written for hi, hinglish and en; Sarvam's checked line for regional languages. */
export function tr(lang: UiLang, key: StringKey | ExtraKey, params: Record<string, string | number> = {}): string {
  let s: string | undefined;
  if (!isRegional(lang)) return key in STRINGS ? t(lang, key as StringKey, params) : EXTRA[key as ExtraKey];
  s = tables.get(lang)?.[key];
  if (s === undefined) return key in STRINGS ? t(baseLang(lang), key as StringKey, params) : EXTRA[key as ExtraKey];
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Dates for the UI. Regional languages use the base language's month names and translated day words. */
export const uiDayMonth = (iso: string, lang: UiLang) => dayMonth(iso, baseLang(lang));
export function uiRelativeDay(iso: string, nowIso: string, lang: UiLang): string {
  if (!isRegional(lang)) return relativeDay(iso, nowIso, lang);
  const en = relativeDay(iso, nowIso, "en");
  const key = en === "Today" ? "rel.today" : en === "Tomorrow" ? "rel.tomorrow" : null;
  if (key) return tr(lang, key);
  const hi = relativeDay(iso, nowIso, "hi");
  return hi === "परसों" ? tr(lang, "rel.dayafter") : uiDayMonth(iso, lang);
}

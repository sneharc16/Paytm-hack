// src/copy/languages.ts: every language Pakka speaks. Hindi, Hinglish and English are hand-written in strings.ts.
// The rest come from Sarvam AI: text through Sarvam Translate (all 22 scheduled languages), voice through Bulbul
// (11 languages) and listening through Saaras (23 languages, with automatic detection).
import type { Lang } from "@/engine/types";

export type RegionalCode =
  | "bn" | "gu" | "kn" | "ml" | "mr" | "od" | "pa" | "ta" | "te"
  | "as" | "brx" | "doi" | "kok" | "ks" | "mai" | "mni" | "ne" | "sa" | "sat" | "sd" | "ur";
export type UiLang = Lang | RegionalCode;

export interface LangInfo {
  code: UiLang;
  /** Sarvam's BCP-47 code. Hinglish is Hindi for speech and English-script Hindi for text. */
  sarvam: string;
  native: string;
  english: string;
  /** Characters a correct translation must contain (its script). */
  script: RegExp;
  /** Bulbul can speak it. Otherwise "Listen" uses Hindi. */
  tts: boolean;
  /** Mayura supports a conversational register; the others use Sarvam Translate (formal). */
  colloquial: boolean;
  rtl?: boolean;
}

const DEVANAGARI = /[ऀ-ॿ]/;
const ARABIC = /[؀-ۿ]/;

export const LANGS: LangInfo[] = [
  { code: "hi", sarvam: "hi-IN", native: "हिंदी", english: "Hindi", script: DEVANAGARI, tts: true, colloquial: true },
  { code: "hinglish", sarvam: "hi-IN", native: "Hinglish", english: "Hinglish", script: /[A-Za-z]/, tts: true, colloquial: true },
  { code: "en", sarvam: "en-IN", native: "English", english: "English", script: /[A-Za-z]/, tts: true, colloquial: true },
  { code: "bn", sarvam: "bn-IN", native: "বাংলা", english: "Bengali", script: /[ঀ-৿]/, tts: true, colloquial: true },
  { code: "mr", sarvam: "mr-IN", native: "मराठी", english: "Marathi", script: DEVANAGARI, tts: true, colloquial: true },
  { code: "te", sarvam: "te-IN", native: "తెలుగు", english: "Telugu", script: /[ఀ-౿]/, tts: true, colloquial: true },
  { code: "ta", sarvam: "ta-IN", native: "தமிழ்", english: "Tamil", script: /[஀-௿]/, tts: true, colloquial: true },
  { code: "gu", sarvam: "gu-IN", native: "ગુજરાતી", english: "Gujarati", script: /[઀-૿]/, tts: true, colloquial: true },
  { code: "kn", sarvam: "kn-IN", native: "ಕನ್ನಡ", english: "Kannada", script: /[ಀ-೿]/, tts: true, colloquial: true },
  { code: "ml", sarvam: "ml-IN", native: "മലയാളം", english: "Malayalam", script: /[ഀ-ൿ]/, tts: true, colloquial: true },
  { code: "od", sarvam: "od-IN", native: "ଓଡ଼ିଆ", english: "Odia", script: /[଀-୿]/, tts: true, colloquial: true },
  { code: "pa", sarvam: "pa-IN", native: "ਪੰਜਾਬੀ", english: "Punjabi", script: /[਀-੿]/, tts: true, colloquial: true },
  { code: "as", sarvam: "as-IN", native: "অসমীয়া", english: "Assamese", script: /[ঀ-৿]/, tts: false, colloquial: false },
  { code: "ur", sarvam: "ur-IN", native: "اردو", english: "Urdu", script: ARABIC, tts: false, colloquial: false, rtl: true },
  { code: "ne", sarvam: "ne-IN", native: "नेपाली", english: "Nepali", script: DEVANAGARI, tts: false, colloquial: false },
  { code: "kok", sarvam: "kok-IN", native: "कोंकणी", english: "Konkani", script: DEVANAGARI, tts: false, colloquial: false },
  { code: "mai", sarvam: "mai-IN", native: "मैथिली", english: "Maithili", script: DEVANAGARI, tts: false, colloquial: false },
  { code: "doi", sarvam: "doi-IN", native: "डोगरी", english: "Dogri", script: DEVANAGARI, tts: false, colloquial: false },
  { code: "brx", sarvam: "brx-IN", native: "बड़ो", english: "Bodo", script: DEVANAGARI, tts: false, colloquial: false },
  { code: "sa", sarvam: "sa-IN", native: "संस्कृतम्", english: "Sanskrit", script: DEVANAGARI, tts: false, colloquial: false },
  { code: "ks", sarvam: "ks-IN", native: "کٲشُر", english: "Kashmiri", script: /[؀-ۿऀ-ॿ]/, tts: false, colloquial: false, rtl: true },
  { code: "sd", sarvam: "sd-IN", native: "سنڌي", english: "Sindhi", script: /[؀-ۿऀ-ॿ]/, tts: false, colloquial: false, rtl: true },
  { code: "mni", sarvam: "mni-IN", native: "ꯃꯤꯇꯩꯂꯣꯟ", english: "Manipuri", script: /[ꯀ-꯿ঀ-৿]/, tts: false, colloquial: false },
  { code: "sat", sarvam: "sat-IN", native: "ᱥᱟᱱᱛᱟᱲᱤ", english: "Santali", script: /[᱐-᱿ऀ-ॿ]/, tts: false, colloquial: false },
];

export const REGIONAL: RegionalCode[] = LANGS.map((l) => l.code).filter((c): c is RegionalCode => c !== "hi" && c !== "hinglish" && c !== "en");
export const langInfo = (code: UiLang) => LANGS.find((l) => l.code === code)!;
export const isRegional = (code: string): code is RegionalCode => (REGIONAL as string[]).includes(code);
export const isUiLang = (code: string): code is UiLang => LANGS.some((l) => l.code === code);
/** The hand-written language closest to a regional one, for the engine and for anything not translated yet. */
export const baseLang = (code: UiLang): Lang => (isRegional(code) ? (langInfo(code).script === DEVANAGARI ? "hi" : "en") : code);
export const fromSarvam = (bcp: string | null | undefined): UiLang | null => (bcp ? LANGS.find((l) => l.sarvam === bcp && l.code !== "hinglish")?.code ?? null : null);

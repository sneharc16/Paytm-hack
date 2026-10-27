// src/lib/format.ts (PRD 18.7)
import type { Lang } from "@/engine/types";

export const inr = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })
    .format(Math.round(paise / 100)); // 15933400 -> "₹1,59,334"

export const timeIST = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
    .format(new Date(iso)).replace("am", "AM").replace("pm", "PM"); // "9:30 PM"

export const timeISTSeconds = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .format(new Date(iso)).replace(/^0/, "");

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

function istParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}

export const dayMonth = (iso: string, lang: Lang) => {
  const { m, day } = istParts(iso);
  return `${day} ${lang === "hi" ? MONTHS_HI[m] : MONTHS_EN[m]}`; // "27 Oct" or "27 अक्टूबर"
};

const REL: Record<Lang, [string, string, string]> = {
  hinglish: ["Aaj", "Kal", "Parson"],
  hi: ["आज", "कल", "परसों"],
  en: ["Today", "Tomorrow", ""],
};

/** "Aaj" / "Kal" / "Parson"; beyond that (or two days out in English), dayMonth. */
export function relativeDay(iso: string, nowIso: string, lang: Lang): string {
  const a = istParts(iso), b = istParts(nowIso);
  const diff = Math.round((Date.UTC(a.y, a.m, a.day) - Date.UTC(b.y, b.m, b.day)) / 86_400_000);
  if (diff >= 0 && diff <= 2 && REL[lang][diff]) return REL[lang][diff];
  return dayMonth(iso, lang);
}

export const amountAria = (paise: number, lang: Lang) =>
  `${Math.round(paise / 100)} ${lang === "en" ? "rupees" : "rupaye"}`;

export const hasDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);

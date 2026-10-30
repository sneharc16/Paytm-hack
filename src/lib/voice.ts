// What Pakka says out loud. One function for the app and for pnpm bake:voice, so the text that was recorded is
// exactly the text the app asks for. Built from the reminder that was sent (its voice script when the model
// wrote one), plus the bank-SMS name line when the brand and the registered name differ.
import { t } from "@/copy/strings";
import { hasNameGap } from "@/engine/namegap";
import type { Session } from "@/engine/session";
import type { Lang, Merchant, PakkaEvent } from "@/engine/types";

/** Join sentences for speech: each part ends with one full stop (। in Hindi), never two. */
function sentences(parts: (string | undefined)[], lang: Lang): string {
  const stop = lang === "hi" ? "।" : ".";
  return parts.map((x) => x?.trim().replace(/[.।]+$/, "")).filter(Boolean).map((x) => (/[?!]$/.test(x!) ? x : `${x}${stop}`)).join(" ");
}

export function nudgeVoiceText(e: PakkaEvent, mer: Merchant): string {
  const p = e.payload;
  const lang = p.language as Lang;
  const voice = (p.voice as string | undefined)?.trim();
  const gap = hasNameGap(mer.brand, mer.legalName) && mer.brandVerified && !(voice ?? "").includes(mer.legalName) ? t(lang, "namegap", { legal: mer.legalName, brand: mer.brand }) : undefined;
  return sentences(voice ? [voice, gap] : [p.title, p.body, gap], lang);
}

/** The latest reminder for this charge in this language, as speech. null when there is none. */
export function sheetVoiceText(s: Session, cycleId: string, lang: Lang): string | null {
  const e = s.events.findLast((x) => x.type === "nudge_sent" && x.payload.cycleId === cycleId && x.payload.language === lang);
  if (!e) return null;
  const m = s.mandateOf(cycleId);
  return nudgeVoiceText(e, s.idx.merchant.get(m.merchantId)!);
}

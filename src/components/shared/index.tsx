"use client";
// Shared components (PRD 19.1, 19.2).
import { useState } from "react";
import { Check, Languages, Volume2 } from "lucide-react";
import { baseLang, LANGS, langInfo, type UiLang } from "@/copy/languages";
import { tr } from "@/copy/regional";
import { amountAria, inr } from "@/lib/format";
import type { PillKind } from "@/lib/views";

export function PakkaSeal({ onNavy = false, label = true }: { onNavy?: boolean; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r="9" fill={onNavy ? "var(--cyan)" : "var(--navy)"} />
        <path d="M5.2 9.3l2.5 2.4 5-5.2" fill="none" stroke={onNavy ? "var(--navy)" : "#fff"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label && <span className={`text-[14px] font-semibold ${onNavy ? "text-white" : "text-navy"}`}>Pakka</span>}
    </span>
  );
}

const PILL: Record<PillKind, string> = {
  answer: "bg-amber-wash text-amber",
  neutral: "bg-navy-wash text-navy",
  done: "bg-green-wash text-green",
  muted: "bg-[#EEF1F5] text-slate",
  fraud: "bg-red-wash text-red",
};
export function StatusPill({ kind, children }: { kind: PillKind; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-[9px] py-px text-[13px] font-semibold leading-[18px] whitespace-nowrap ${PILL[kind]}`}>{children}</span>;
}

export function Amount({ paise, size = "m", lang = "en", className = "" }: { paise: number; size?: "l" | "m"; lang?: UiLang; className?: string }) {
  const cls = size === "l" ? "text-[22px] leading-[26px]" : "text-[17px] leading-[22px]";
  return <span aria-label={amountAria(paise, baseLang(lang))} className={`tnum font-bold ${cls} ${className}`}>{inr(paise)}</span>;
}

export function MerchantTile({ brand, tile, size = 40 }: { brand: string; tile: { bg: string; fg: string }; size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-[10px] font-bold" style={{ width: size, height: size, background: tile.bg, color: tile.fg, fontSize: size * 0.42 }}>
      {brand[0]}
    </span>
  );
}

export function AIFooter({ lang, align = "center", list = false }: { lang: UiLang; align?: "center" | "left"; list?: boolean }) {
  return <p className={`text-[13px] text-slate ${align === "center" ? "text-center" : ""}`}>{tr(lang, list ? "ai.footer.list" : "ai.footer")}</p>;
}

export function KillSwitchBanner({ on, lang = "hinglish" }: { on: boolean; lang?: UiLang }) {
  if (!on) return null;
  return <div role="status" className="flex h-9 items-center justify-center bg-amber-wash px-4 text-[14px] font-semibold text-amber">{tr(lang, "killswitch.banner")}</div>;
}

/** All 24 languages. Hindi, Hinglish and English are hand-written; the rest are Sarvam AI's, checked line by line.
 *  A speaker icon marks languages Sarvam can also speak. */
export function LangPicker({ lang, onChange }: { lang: UiLang; onChange: (l: UiLang) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox" className="inline-flex min-w-12 items-center gap-1 rounded-full border border-line-strong px-3 py-1 text-[13px] font-semibold text-navy" aria-label="Change language">
        <Languages size={14} aria-hidden />{langInfo(lang).native}
      </button>
      {open && (
        <ul role="listbox" aria-label="Language" className="absolute right-0 top-9 z-30 max-h-[340px] w-[210px] overflow-y-auto rounded-[12px] border border-line bg-surface py-1" style={{ boxShadow: "var(--shadow-float)" }}>
          {LANGS.map((l) => (
            <li key={l.code}>
              <button role="option" aria-selected={l.code === lang} onClick={() => { onChange(l.code); setOpen(false); }} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] ${l.code === lang ? "bg-cyan-wash font-semibold text-navy" : "text-ink"}`}>
                <span dir={l.rtl ? "rtl" : "ltr"} className="flex-1">{l.native}</span>
                <span className="text-[12px] text-slate">{l.english}</span>
                {l.tts && <Volume2 size={13} className="text-slate" aria-label="Can speak" />}
                {l.code === lang && <Check size={14} className="text-navy" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** The signature element: the window from "we told you" to "money leaves" (PRD 19.2). */
export function DebitTimeline({
  variant = "ask", startMs, endMs, nowMs, left, right, attempts, ended = false, ariaLabel,
}: {
  variant?: "ask" | "retry" | "compact"; startMs: number; endMs: number; nowMs: number;
  left?: [string, string]; right?: [string, string]; attempts?: { at: number; state: "used" | "scheduled" | "later" }[];
  ended?: boolean; ariaLabel?: string;
}) {
  const share = Math.max(0, Math.min(1, (nowMs - startMs) / Math.max(1, endMs - startMs)));
  const h = variant === "compact" ? 4 : 6;
  const pos = (x: number) => `calc(7px + (100% - 14px) * ${Math.max(0, Math.min(1, x))})`;
  return (
    <div role="img" aria-label={ariaLabel} className="w-full">
      <div className="relative" style={{ height: 14 }}>
        <div className="absolute top-1/2 -translate-y-1/2 rounded-[3px] bg-line" style={{ left: 7, right: 7, height: h }} />
        <div className="absolute top-1/2 -translate-y-1/2 rounded-[3px]" style={{ left: 7, width: `calc((100% - 14px) * ${share})`, height: h, background: "linear-gradient(90deg, var(--cyan), var(--navy))" }} />
        {variant === "retry" && attempts?.map((a, i) => (
          <span key={i} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{
            left: pos((a.at - startMs) / Math.max(1, endMs - startMs)), width: 10, height: 10,
            background: a.state === "used" ? "var(--mist)" : a.state === "scheduled" ? "var(--navy)" : "#fff",
            border: a.state === "later" ? "2px solid var(--line-strong)" : "none",
          }} />
        ))}
        {variant !== "retry" && (
          <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45" style={{ left: pos(1), width: 12, height: 12, background: ended ? "var(--mist)" : "var(--navy)" }} />
        )}
        <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: pos(share), width: 14, height: 14, border: "3px solid var(--cyan)" }} />
      </div>
      {variant !== "compact" && (left || right) && (
        <div className="mt-2 flex justify-between gap-3 text-[14px] leading-5">
          <div>{left && <><div className="font-semibold text-ink">{left[0]}</div><div className="text-slate">{left[1]}</div></>}</div>
          <div className="text-right">{right && <><div className="font-semibold text-ink">{right[0]}</div><div className="text-slate">{right[1]}</div></>}</div>
        </div>
      )}
    </div>
  );
}

export function RuleChip({ id }: { id: string }) {
  return <span className="inline-block rounded-[4px] bg-navy-wash px-1.5 py-px text-[12px] font-semibold text-navy">{id}</span>;
}

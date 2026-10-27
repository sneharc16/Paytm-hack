"use client";
// /dev/components: every shared building block on one page, for checking against the mockups (PRD 19).
import { useState } from "react";
import { t } from "@/copy/strings";
import type { Lang } from "@/engine/types";
import { AIFooter, Amount, DebitTimeline, KillSwitchBanner, LangToggle, MerchantTile, PakkaSeal, RuleChip, StatusPill } from "@/components/shared";

const t0 = Date.parse("2026-10-26T15:40:00Z");
const t1 = Date.parse("2026-10-27T16:00:00Z");

function Item({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-[13px] font-semibold text-slate">{name}</h2>
      {children}
    </section>
  );
}

export default function Gallery() {
  const [lang, setLang] = useState<Lang>("hinglish");
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:px-8">
      <div className="flex items-center gap-3"><PakkaSeal /><h1 className="text-[26px] font-bold text-navy">Components</h1><span className="ml-auto"><LangToggle lang={lang} onChange={setLang} /></span></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Item name="PakkaSeal">
          <div className="flex items-center gap-4"><PakkaSeal /><span className="rounded-[10px] bg-navy p-2"><PakkaSeal onNavy /></span></div>
        </Item>
        <Item name="StatusPill">
          <div className="flex flex-wrap gap-2">
            <StatusPill kind="answer">{t(lang, "pill.answer")}</StatusPill><StatusPill kind="neutral">{t(lang, "pill.balance")}</StatusPill>
            <StatusPill kind="done">{t(lang, "pill.done")}</StatusPill><StatusPill kind="muted">{t(lang, "pill.skipped")}</StatusPill><StatusPill kind="fraud">PAK-2314</StatusPill>
          </div>
        </Item>
        <Item name="Amount and MerchantTile">
          <div className="flex items-center gap-4">
            <MerchantTile brand="PadhoAI" tile={{ bg: "#FDEBDD", fg: "#A4461A" }} /><MerchantTile brand="StadiumPass" tile={{ bg: "#E3F1E6", fg: "#2E6B3A" }} />
            <Amount paise={59900} lang={lang} /><Amount paise={1845000} size="l" lang={lang} />
          </div>
        </Item>
        <Item name="RuleChip and AIFooter">
          <div className="flex flex-col gap-2"><span className="flex gap-2"><RuleChip id="DH_ASK_V1" /><RuleChip id="mandate-risk-v1" /></span><AIFooter lang={lang} align="left" /></div>
        </Item>
      </div>
      <Item name="DebitTimeline: ask">
        <DebitTimeline startMs={t0} endMs={t1} nowMs={t0 + (t1 - t0) * 0.15} left={[`9:10 PM`, t(lang, "timeline.now")]} right={[t(lang, "timeline.after", { time: "9:30 PM" }), t(lang, "timeline.end", { amount: "₹599" })]} />
      </Item>
      <div className="grid gap-4 md:grid-cols-2">
        <Item name="DebitTimeline: retry">
          <DebitTimeline variant="retry" startMs={0} endMs={4} nowMs={1.2} attempts={[{ at: 0.2, state: "used" }, { at: 1.4, state: "scheduled" }, { at: 2.6, state: "later" }, { at: 3.8, state: "later" }]} />
        </Item>
        <Item name="DebitTimeline: compact">
          <DebitTimeline variant="compact" startMs={t0} endMs={t1} nowMs={t0 + (t1 - t0) * 0.6} />
        </Item>
      </div>
      <Item name="KillSwitchBanner"><KillSwitchBanner on lang={lang} /></Item>
      <Item name="Buttons">
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary h-12 rounded-full px-6 text-[16px] font-semibold">{t(lang, "choice.skip")}</button>
          <button disabled className="btn-primary h-12 rounded-full px-6 text-[16px] font-semibold">{t(lang, "button.choose")}</button>
          <button className="btn-soft h-12 rounded-full px-6 text-[16px] font-semibold">{t(lang, "sheet.listen")}</button>
        </div>
      </Item>
    </main>
  );
}

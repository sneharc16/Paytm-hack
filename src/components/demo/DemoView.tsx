"use client";
// Demo view, /demo (PRD 20.4): clock, step rail, twin counters, small counters, choice breakdown, live feed.
// /demo?grid=1 shows phone, merchant, control room and counters on one screen.
import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { ist, ms, MOMENTS } from "@/engine/clock";
import { metrics } from "@/engine/metrics";
import type { Session } from "@/engine/session";
import { dayMonth, inr, timeIST } from "@/lib/format";
import { recorderRow } from "@/lib/recorder";
import { sessionIdFromUrl, useSimNow, useSync } from "@/lib/sync/client";
import { PakkaSeal } from "@/components/shared";
import ConsumerApp from "@/components/consumer/ConsumerApp";
import MerchantConsole from "@/components/merchant/MerchantConsole";
import ControlRoom from "@/components/ops/ControlRoom";

const STEPS = [
  { label: "Review spike", at: ist("2026-10-26 20:58") },
  { label: "Merchant turns on asking", at: ist("2026-10-26 21:06") },
  { label: "Sweep", at: ist("2026-10-26 21:10") },
  { label: "Sunita and Rahul", at: ist("2026-10-28 18:05") },
  { label: "Refunds", at: ist("2026-10-28 21:45") },
  { label: "A person steps in", at: ist("2026-10-29 06:00") },
];

function useCountUp(value: number) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 600);
      setShown(Math.round(a + (value - a) * k));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

export default function DemoView() {
  const start = useSync((s) => s.start);
  const session = useSync((s) => s.session);
  useSync((s) => s.version);
  const [grid, setGrid] = useState(false);
  useEffect(() => { start(sessionIdFromUrl()); setGrid(new URLSearchParams(window.location.search).get("grid") === "1"); }, [start]);
  if (!session) return <div className="p-8 text-slate">Loading</div>;
  if (grid) {
    return (
      <main className="grid h-screen grid-cols-[390px_1fr] grid-rows-2 gap-2 bg-canvas p-2">
        <div className="row-span-2 overflow-hidden rounded-[20px] border border-line bg-surface"><ConsumerApp embedded /></div>
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface"><Counters s={session} compact /></div>
        <div className="grid grid-cols-2 gap-2 overflow-hidden">
          <div className="overflow-hidden rounded-[12px] border border-line"><MerchantConsole embedded /></div>
          <div className="overflow-hidden rounded-[12px] border border-line"><ControlRoom embedded /></div>
        </div>
      </main>
    );
  }
  return <main className="min-h-screen"><Counters s={session} /></main>;
}

function Counters({ s, compact = false }: { s: Session; compact?: boolean }) {
  const now = useSimNow();
  const clock = useSync((x) => x.clock);
  const clockCmd = useSync((x) => x.clockCmd);
  const failures = useSync((x) => x.failures);
  const m = metrics(s);
  const stopped = useCountUp(m.unwantedStopped);
  const collected = useCountUp(m.atRiskCollected);
  const nextMoment = MOMENTS.find((x) => ms(x.at) > ms(now) + 30_000);
  const current = STEPS.reduce((acc, st, i) => (ms(now) >= ms(st.at) ? i : acc), -1);
  // The feed tells the story: routine charges and reminders on ordinary mandates stay in the audit log.
  const storyEvent = (e: (typeof s.events)[number]) => {
    const cycleId = e.payload.cycleId ?? (e.subjectType === "cycle" ? e.subjectId : undefined);
    const group = cycleId ? s.idx.cycle.get(cycleId)?.group : undefined;
    return group !== "ordinary" && e.type !== "risk_scored" && e.type !== "notice_received";
  };
  const feed = s.events.slice(-1500).reverse().filter(storyEvent).map((e) => recorderRow(s, e)).filter((r): r is NonNullable<typeof r> => !!r).slice(0, compact ? 6 : 14);
  const b = m.choiceBreakdown;
  const total = b.keep + b.skip + b.pause + b.cancel + b.none || 1;
  const pad = compact ? "p-3" : "px-8 pb-8 pt-[22px]";
  return (
    <div className={`${pad} flex h-full flex-col gap-4 overflow-y-auto`}>
      <header className="flex flex-wrap items-center gap-3">
        <PakkaSeal /><h1 className={`${compact ? "text-[17px]" : "text-[22px]"} font-bold text-navy`}>Demo view</h1>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => clockCmd({ action: "restart" })} className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-[14px] font-semibold text-navy"><RotateCcw size={16} />Restart demo</button>
          <div className="rounded-[10px] border border-line bg-surface px-3 py-1.5">
            <div className="tnum text-[22px] font-bold leading-6">{timeIST(now)}</div>
            <div className="text-[13px] text-slate">{dayMonth(now, "en")}, demo clock</div>
          </div>
          <button aria-label={clock.paused ? "Play" : "Pause"} onClick={() => clockCmd({ action: clock.paused ? "play" : "pause" })} className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-navy text-white">{clock.paused ? <Play size={18} /> : <Pause size={18} />}</button>
          {[60, 600, 3600].map((sp) => (
            <button key={sp} onClick={() => clockCmd({ action: "speed", value: sp })} className={`h-10 rounded-[10px] px-2.5 text-[14px] font-semibold ${clock.speed === sp ? "bg-navy-wash text-navy" : "border border-line-strong text-slate"}`}>{sp / 60}×</button>
          ))}
          {nextMoment && <button onClick={() => clockCmd({ action: "jump", value: nextMoment.at })} className="inline-flex h-10 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-[14px] font-semibold text-navy" title={nextMoment.label}><SkipForward size={16} />Jump to next moment</button>}
        </div>
      </header>
      {failures.length > 0 && <p className="rounded-[10px] bg-red-wash p-3 text-[14px] text-red">Invariant failed, clock paused: {failures[0]}</p>}
      <ol className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        {STEPS.map((st, i) => (
          <li key={st.label}>
            <button onClick={() => clockCmd({ action: "jump", value: st.at })} className={`w-full rounded-[10px] border px-3 py-2 text-left text-[14px] ${i === current ? "border-navy font-semibold text-navy shadow-[0_0_0_1px_var(--navy)]" : i < current ? "border-line text-slate" : "border-line-strong text-ink"}`}>{st.label}</button>
          </li>
        ))}
      </ol>
      <div className={`grid gap-4 ${compact ? "" : "lg:grid-cols-[1fr_1fr_360px]"}`}>
        <div className={`grid gap-4 ${compact ? "grid-cols-2" : "lg:col-span-2 lg:grid-cols-2"}`}>
          <section className="rounded-[12px] border border-line bg-surface p-5">
            <p className="text-[14px] font-semibold text-slate">For customers</p>
            <p className="text-[15px]">Charges people didn&apos;t want, stopped before they left</p>
            <p className={`tnum mt-2 font-extrabold text-navy ${compact ? "text-[36px] leading-10" : "text-[56px] leading-[60px]"}`}>{inr(stopped)}</p>
            <p className="text-[14px] text-slate">{m.unwantedStoppedCount} people, {inr(m.unwantedUnit)} each</p>
          </section>
          <section className="rounded-[12px] border border-line bg-surface p-5">
            <p className="text-[14px] font-semibold text-slate">For merchants</p>
            <p className="text-[15px]">At-risk charges that still went through</p>
            <p className={`tnum mt-2 font-extrabold text-green ${compact ? "text-[36px] leading-10" : "text-[56px] leading-[60px]"}`}>{inr(collected)}</p>
            <p className="text-[14px] text-slate">{m.atRiskCollectedCount} of {m.atRiskTotal} people whose last charge failed on balance, {inr(m.atRiskUnit)} each</p>
          </section>
          <section className={`grid grid-cols-2 divide-x divide-y divide-line rounded-[12px] border border-line bg-surface md:grid-cols-4 md:divide-y-0 ${compact ? "col-span-2" : "lg:col-span-2"}`}>
            {[[String(m.keptBySkipOrPause), "Kept as customers through skip or pause"], [inr(m.refundedUnderMerchantRules), "Refunded under PadhoAI's own rules"], [String(m.casesToPerson), "Cases handed to a person"], [String(m.movedWithoutRule), "Money moved without a rule"]].map(([v, l], i) => (
              <div key={l} className={`p-4 ${i === 3 && m.movedWithoutRule > 0 ? "bg-red-wash text-red" : ""}`}><div className="tnum text-[22px] font-bold">{v}</div><div className="text-[13.5px] text-slate">{l}</div></div>
            ))}
          </section>
          <section className={`rounded-[12px] border border-line bg-surface p-5 ${compact ? "col-span-2" : "lg:col-span-2"}`}>
            <h2 className="text-[15px] font-semibold">What the 318 people chose</h2>
            <div className="mt-2 flex h-9 overflow-hidden rounded-[8px]">
              {([["Keep", b.keep, "#002E6E"], ["Skip this month", b.skip, "#0A3F86"], ["Pause", b.pause, "#3D649F"], ["Cancel", b.cancel, "#7D98C2"], ["No answer", b.none, "#CBD5E3"]] as const).map(([l, v, c]) => v > 0 && (
                <div key={l} className="flex items-center justify-center text-[13px] font-semibold" style={{ width: `${(v / total) * 100}%`, background: c, color: c === "#CBD5E3" ? "var(--ink)" : "#fff" }} title={`${l} ${v}`}>{v}</div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[13px] text-slate">
              {([["Keep", "#002E6E"], ["Skip this month", "#0A3F86"], ["Pause", "#3D649F"], ["Cancel", "#7D98C2"], ["No answer", "#CBD5E3"]] as const).map(([l, c]) => <span key={l} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
            </div>
          </section>
        </div>
        {!compact && (
          <section className="rounded-[12px] border border-line bg-surface p-5">
            <h2 className="text-[15px] font-semibold">Live</h2>
            <ol className="mt-2 divide-y divide-line">
              {feed.map((r) => (
                <li key={r.id} className="grid grid-cols-[64px_1fr] gap-2 py-2 text-[14px]">
                  <span className="tnum text-[13px] font-semibold text-slate">{timeIST(r.at)}<span className="block text-[11px] font-normal">{dayMonth(r.at, "en")}</span></span>
                  <span><b className="font-semibold">{r.title}</b>{r.detail && <span className="block text-[13px] text-slate">{r.detail}</span>}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

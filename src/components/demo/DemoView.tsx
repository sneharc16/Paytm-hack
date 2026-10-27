"use client";
// Demo view, /demo (PRD 20.4): clock, step rail, twin counters, small counters, choice breakdown, live feed.
// /demo?grid=1 shows phone, merchant, control room and counters on one screen.
import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward, Sparkles } from "lucide-react";
import { ist, ms, MOMENTS } from "@/engine/clock";
import { metrics } from "@/engine/metrics";
import type { Session } from "@/engine/session";
import type { PakkaEvent } from "@/engine/types";
import { dayMonth, inr, timeIST } from "@/lib/format";
import { recorderRow } from "@/lib/recorder";
import { sessionIdFromUrl, useSimNow, useSync } from "@/lib/sync/client";
import { PakkaSeal } from "@/components/shared";
import ConsumerApp from "@/components/consumer/ConsumerApp";
import MerchantConsole from "@/components/merchant/MerchantConsole";
import ControlRoom from "@/components/ops/ControlRoom";

type Tab = "story" | "merchant" | "ops";
const STEPS: { label: string; at: string; tab: Tab; say: string }[] = [
  { label: "Review spike", at: ist("2026-10-26 20:58"), tab: "ops", say: "Review Radar catches 46 complaints about a ₹1 trial in six hours. 38 of them are a consent gap." },
  { label: "Merchant turns on asking", at: ist("2026-10-26 21:06"), tab: "merchant", say: "PadhoAI is told privately, no public shaming, and switches on: charge only after the customer says yes. Watch the checkout badge." },
  { label: "Sweep", at: ist("2026-10-26 21:10"), tab: "story", say: "Pakka sweeps 1,300 mandates and asks 318 people in their own language. On the phone, open Sunita's sheet and skip this month. No PIN needed." },
  { label: "Sunita and Rahul", at: ist("2026-10-28 18:05"), tab: "ops", say: "Sunita's flight recorder shows the score, the rule and the merchant's reply. Switch the phone to Rahul: his top-up at 6:05 PM waits for the 9:30 PM off-peak slot." },
  { label: "Refunds", at: ist("2026-10-28 21:45"), tab: "story", say: "Rahul's retry went through. 21 refunds went out under PadhoAI's own rule; anything outside it went to PadhoAI to decide." },
  { label: "A person steps in", at: ist("2026-10-29 06:00"), tab: "ops", say: "Farhan's ₹1,499 went to Priya with the case already written, and a callback from a 1600 number. Money moved without a rule: zero." },
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
  if (grid) return <Presenter s={session} />;
  return <main className="min-h-screen"><Counters s={session} /></main>;
}

function Counters({ s, compact = false, panel = false }: { s: Session; compact?: boolean; panel?: boolean }) {
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
  const pad = compact ? "p-3" : panel ? "p-5" : "px-8 pb-8 pt-[22px]";
  return (
    <div className={`${pad} flex flex-col gap-4 ${panel ? "" : "h-full overflow-y-auto"}`}>
      {!panel && <><header className="flex flex-wrap items-center gap-3">
        <PakkaSeal /><h1 className={`${compact ? "text-[17px]" : "text-[22px]"} font-bold text-navy`}>Demo view</h1>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => clockCmd({ action: "restart" })} className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-[14px] font-semibold text-navy"><RotateCcw size={16} />Restart demo</button>
          <div className="rounded-[10px] border border-line bg-surface px-3 py-1.5">
            <div className="tnum text-[22px] font-bold leading-6">{timeIST(now)}</div>
            <div className="text-[13px] text-slate">{dayMonth(now, "en")}, demo clock</div>
          </div>
          <button aria-label={clock.paused ? "Play" : "Pause"} onClick={() => clockCmd({ action: clock.paused ? "play" : "pause" })} className="flex h-10 w-10 items-center justify-center rounded-full btn-primary text-white">{clock.paused ? <Play size={18} /> : <Pause size={18} />}</button>
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
      </ol></>}
      <div className={`grid gap-4 ${compact ? "" : panel ? "grid-cols-1" : "lg:grid-cols-[1fr_1fr_360px]"}`}>
        <div className={`grid gap-4 ${compact ? "grid-cols-2" : "lg:col-span-2 lg:grid-cols-2"}`}>
          <section className="card p-5">
            <p className="text-[14px] font-semibold text-slate">For customers</p>
            <p className="text-[15px]">Charges people didn&apos;t want, stopped before they left</p>
            <p className={`tnum mt-2 font-extrabold text-navy ${compact ? "text-[36px] leading-10" : "text-[56px] leading-[60px]"}`}>{inr(stopped)}</p>
            <p className="text-[14px] text-slate">{m.unwantedStoppedCount} people, {inr(m.unwantedUnit)} each</p>
          </section>
          <section className="card p-5">
            <p className="text-[14px] font-semibold text-slate">For merchants</p>
            <p className="text-[15px]">At-risk charges that still went through</p>
            <p className={`tnum mt-2 font-extrabold text-green ${compact ? "text-[36px] leading-10" : "text-[56px] leading-[60px]"}`}>{inr(collected)}</p>
            <p className="text-[14px] text-slate">{m.atRiskCollectedCount} of {m.atRiskTotal} people whose last charge failed on balance, {inr(m.atRiskUnit)} each</p>
          </section>
          <section className={`grid grid-cols-2 divide-x divide-y divide-line card md:grid-cols-4 md:divide-y-0 ${compact ? "col-span-2" : "lg:col-span-2"}`}>
            {[[String(m.keptBySkipOrPause), "Kept as customers through skip or pause"], [inr(m.refundedUnderMerchantRules), "Refunded under PadhoAI's own rules"], [String(m.casesToPerson), "Cases handed to a person"], [String(m.movedWithoutRule), "Money moved without a rule"]].map(([v, l], i) => (
              <div key={l} className={`p-4 ${i === 3 && m.movedWithoutRule > 0 ? "bg-red-wash text-red" : ""}`}><div className="tnum text-[22px] font-bold">{v}</div><div className="text-[13.5px] text-slate">{l}</div></div>
            ))}
          </section>
          <section className={`card p-5 ${compact ? "col-span-2" : "lg:col-span-2"}`}>
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
          <section className="w-full card p-5">
            <h2 className="text-[15px] font-semibold">Live</h2>
            {feed.length === 0 && <p className="mt-2 text-[14px] text-slate">Nothing yet. Press play.</p>}
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

/** A short, friendly line for the moments worth a toast. */
function toastFor(s: Session, e: PakkaEvent): { title: string; tone: "blue" | "green" | "amber" } | null {
  const p = e.payload;
  const persona = (cycleId?: string) => {
    const c = cycleId ? s.idx.cycle.get(cycleId) : undefined;
    return c ? s.idx.user.get(s.idx.mandate.get(c.mandateId)!.userId) : undefined;
  };
  if (e.type === "incident_opened") return { title: `Review Radar opened ${p.incidentId}: ${p.metrics.count} complaints in 6 hours`, tone: "amber" };
  if (e.type === "merchant_settings_changed" && p.settings.askBeforeFirstCharge) return { title: `${p.by} turned on "Charge only after a yes"`, tone: "blue" };
  if (e.type === "nudge_sent" && persona(p.cycleId)?.persona === "sunita" && p.kind === "ask") return { title: "Sunita's phone: Pakka is asking about ₹599", tone: "blue" };
  if (e.type === "notice_withdrawn" && persona(p.cycleId)?.persona === "sunita") return { title: "Sunita skipped this month. No PIN, no charge.", tone: "green" };
  if (e.type === "retry_scheduled" && persona(p.cycleId)?.persona === "rahul") return { title: `Rahul's retry booked for ${timeIST(p.executeAt)}, after the peak window`, tone: "blue" };
  if (e.type === "execution_succeeded" && persona(p.cycleId)?.persona === "rahul") return { title: "Rahul's ₹299 went through. StadiumPass stays on.", tone: "green" };
  if (e.type === "case_assigned") return { title: `${p.code} handed to Priya with the case written`, tone: "amber" };
  if (e.type === "human_decision") return { title: `${p.by} decided ${p.code}`, tone: "green" };
  return null;
}

function useToasts(s: Session) {
  const [toasts, setToasts] = useState<{ id: number; title: string; tone: "blue" | "green" | "amber" }[]>([]);
  const seen = useRef(-1);
  const count = s.events.length;
  useEffect(() => {
    if (seen.current < 0 || count < seen.current) { seen.current = count; return; } // no toasts for history
    const fresh = s.events.slice(seen.current).map((e) => ({ e, t: toastFor(s, e) })).filter((x) => x.t).slice(-3);
    seen.current = count;
    if (!fresh.length) return;
    setToasts((old) => [...old, ...fresh.map(({ e, t }) => ({ id: e.id, ...t! }))].slice(-3));
    const ids = fresh.map((x) => x.e.id);
    const timer = setTimeout(() => setToasts((old) => old.filter((x) => !ids.includes(x.id))), 4500);
    return () => clearTimeout(timer);
  }, [count, s]);
  return toasts;
}

/** /demo?grid=1: one screen for the stage. Phone on the left, one large panel on the right that follows the story. */
function Presenter({ s }: { s: Session }) {
  const now = useSimNow();
  const clock = useSync((x) => x.clock);
  const clockCmd = useSync((x) => x.clockCmd);
  const current = STEPS.reduce((acc, st, i) => (ms(now) >= ms(st.at) ? i : acc), -1);
  const [tab, setTab] = useState<Tab>("story");
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t === "story" || t === "merchant" || t === "ops") { setTab(t); setPinned(true); }
  }, []);
  useEffect(() => { setPinned(false); }, [current]);
  const toasts = useToasts(s);
  const shown: Tab = pinned || current < 0 ? tab : STEPS[current].tab;
  const nextMoment = MOMENTS.find((x) => ms(x.at) > ms(now) + 30_000);
  const tabs: { id: Tab; label: string }[] = [{ id: "story", label: "Counters" }, { id: "merchant", label: "Merchant" }, { id: "ops", label: "Control room" }];
  const TONE = { blue: "bg-sky-soft text-blue", green: "bg-green-wash text-green", amber: "bg-amber-wash text-amber" };
  return (
    <main className="flex min-h-screen flex-col bg-canvas lg:h-screen lg:overflow-hidden">
      <header className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/70 bg-white/90 px-4 py-3 backdrop-blur-md sm:px-5">
        <a href="/" aria-label="Home" className="flex items-center gap-2"><PakkaSeal /></a>
        <h1 className="hidden text-[16px] font-bold text-navy sm:block">The 3 minute story</h1>
        <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <div className="mr-1 sm:text-right">
            <div className="tnum text-[18px] font-bold leading-6 text-navy sm:text-[20px]">{timeIST(now)}</div>
            <div className="text-[12px] text-slate">{dayMonth(now, "en")}, demo clock</div>
          </div>
          <button aria-label={clock.paused ? "Play" : "Pause"} onClick={() => clockCmd({ action: clock.paused ? "play" : "pause" })} className="btn-primary flex h-11 w-11 items-center justify-center rounded-full">{clock.paused ? <Play size={18} /> : <Pause size={18} />}</button>
          <div className="flex rounded-full bg-canvas p-1 ring-1 ring-line">
            {[60, 600, 3600].map((sp) => (
              <button key={sp} onClick={() => clockCmd({ action: "speed", value: sp })} className={`press h-9 rounded-full px-3 text-[13px] font-semibold ${clock.speed === sp ? "bg-white text-blue shadow-[var(--shadow-card)]" : "text-slate"}`}>{sp / 60}×</button>
            ))}
          </div>
          {nextMoment && <button onClick={() => clockCmd({ action: "jump", value: nextMoment.at })} className="btn-soft inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold" title={nextMoment.label}><SkipForward size={16} />Next moment</button>}
          <button onClick={() => clockCmd({ action: "restart" })} aria-label="Restart demo" title="Restart demo" className="press flex h-11 w-11 items-center justify-center rounded-full bg-white text-navy ring-1 ring-line hover:ring-blue"><RotateCcw size={16} /></button>
        </div>
      </header>

      <div className="shrink-0 px-4 pt-4 sm:px-5">
        <ol className="flex gap-1.5">
          {STEPS.map((st, i) => (
            <li key={st.label} className="min-w-0 flex-1">
              <button onClick={() => clockCmd({ action: "jump", value: st.at })} className="group w-full text-left" aria-current={i === current ? "step" : undefined}>
                <span className={`block h-2 rounded-full transition-colors ${i < current ? "bg-blue" : i === current ? "bg-gradient-to-r from-sky to-blue" : "bg-line group-hover:bg-line-strong"}`} />
                <span className={`mt-1.5 truncate text-[13px] ${i === current ? "block font-semibold text-navy" : "hidden text-slate md:block"}`}>{i + 1}. {st.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="card mt-3 flex items-start gap-3 px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky to-blue text-white"><Sparkles size={16} aria-hidden /></span>
          <p className="text-[15px] leading-6 text-ink">
            {current < 0 ? "Press play or Next moment to begin. The story starts at 8:55 PM on Monday 26 Oct, 24 hours before PadhoAI's first charges." : STEPS[current].say}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:px-5 lg:min-h-0 lg:flex-1 lg:flex-row">
        <div className="mx-auto w-full max-w-[390px] shrink-0 lg:mx-0 lg:h-full lg:w-[360px] xl:w-[390px]">
          <div className="h-[720px] overflow-hidden rounded-[40px] bg-[#0B1730] p-2.5 shadow-[0_24px_60px_rgba(0,46,110,0.22)] lg:h-full lg:max-h-[844px]">
            <div className="h-full overflow-hidden rounded-[32px] bg-surface"><ConsumerApp embedded /></div>
          </div>
        </div>
        <section className="card flex min-h-[640px] min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <div role="tablist" className="flex rounded-full bg-canvas p-1 ring-1 ring-line">
              {tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={shown === t.id} onClick={() => { setTab(t.id); setPinned(true); }}
                  className={`press h-9 rounded-full px-4 text-[14px] font-semibold ${shown === t.id ? "bg-white text-blue shadow-[var(--shadow-card)]" : "text-slate hover:text-ink"}`}>{t.label}</button>
              ))}
            </div>
            {!pinned && current >= 0 && <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-slate"><span className="h-2 w-2 rounded-full bg-green" />Following the story</span>}
            {pinned && <button onClick={() => setPinned(false)} className="ml-auto text-[13px] font-semibold text-blue">Follow the story</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {shown === "story" && <Counters s={s} panel />}
            {shown === "merchant" && <MerchantConsole embedded />}
            {shown === "ops" && <ControlRoom embedded />}
          </div>
        </section>
      </div>

      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="anim-toast pointer-events-auto flex items-center gap-3 rounded-[16px] bg-white p-3 shadow-[var(--shadow-card-hover)] ring-1 ring-line">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE[t.tone]}`}><Sparkles size={16} aria-hidden /></span>
            <span className="text-[14px] font-semibold text-ink">{t.title}</span>
          </div>
        ))}
      </div>
    </main>
  );
}

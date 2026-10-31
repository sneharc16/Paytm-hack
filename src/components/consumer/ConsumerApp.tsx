"use client";
// Consumer app, /app (PRD 20.1): C1 list, C2 Doosri Haan sheet, C3 PIN pad, C4 result, C5 retry,
// C6 refund offer and tracker, C7 and C8 case and callback, C9 detail, C10 Pakka se poochho.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Info, Lock, Mic, Phone, ShieldCheck, Clock, Volume2, Pause, Check, Square, X, Plus } from "lucide-react";
import { type StringKey } from "@/copy/strings";
import { baseLang, isRegional, langInfo, type UiLang } from "@/copy/languages";
import { hasTable, tr, uiDayMonth, uiRelativeDay } from "@/copy/regional";
import { speakWithSarvam, startListening, toEnglish, useRegional } from "@/lib/regional-client";
import { addMin, ist, istDay, ms, peakWindow } from "@/engine/clock";
import { addMonths } from "@/engine/live";
import { maxSkipsAllowed } from "@/engine/state";
import { intakeTemplate } from "@/engine/actions";
import { hasNameGap } from "@/engine/namegap";
import type { Intake } from "@/engine/resolve";
import type { Command } from "@/engine/commands";
import type { Choice, Persona } from "@/engine/types";
import { inr, timeIST } from "@/lib/format";
import { useLive } from "@/lib/live-client";
import { sessionIdFromUrl, useSimNow, useSync } from "@/lib/sync/client";
import { callModel } from "@/lib/llm-client";
import { PERSONAS, currentCycle, isCollect, needsAnswer, pillFor, rowsFor, sectionOf, type Row } from "@/lib/views";
import { AIFooter, Amount, DebitTimeline, KillSwitchBanner, LangPicker, MerchantTile, PakkaSeal, StatusPill } from "@/components/shared";
import type { Session } from "@/engine/session";

type Screen = { name: "list" } | { name: "detail"; mandateId: string } | { name: "retry"; mandateId: string };
type Sheet = null | { name: "decision"; cycleId: string } | { name: "pin"; cycleId: string; choice: "pause" | "cancel" } | { name: "result"; cycleId: string; choice: Choice; status: string } | { name: "fraud"; code?: string; mandateId?: string } | { name: "escalate" } | { name: "custom"; node: ReactNode };

/** Who runs the engine behind the phone: the demo replay (useSync) or a real person's server (Pakka live). */
export interface Host { send: (c: Command) => Promise<unknown>; /** What the pause and cancel options say they need (the PIN, or Pakka live's passkey). */ confirmTag?: StringKey }
const HostCtx = createContext<Host | null>(null);
export const HostProvider = HostCtx.Provider;
const useHost = () => useContext(HostCtx)!;

function readParam(k: string) { return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(k); }

export default function ConsumerApp({ embedded = false }: { embedded?: boolean }) {
  const start = useSync((s) => s.start);
  const session = useSync((s) => s.session);
  const send = useSync((s) => s.send);
  useSync((s) => s.version);
  const now = useSimNow();
  const [persona, setPersona] = useState<Persona>("sunita");
  const [langOverride, setLangOverride] = useState<Partial<Record<Persona, UiLang>>>({});
  const [reset, setReset] = useState(0);

  useEffect(() => {
    start(sessionIdFromUrl());
    const p = readParam("persona") as Persona | null;
    if (p && PERSONAS.some((x) => x.id === p)) setPersona(p);
    try { setLangOverride(JSON.parse(localStorage.getItem("pakka-lang") ?? "{}")); } catch { /* storage blocked */ }
  }, [start]);

  useRegional((x) => x.version);
  const chosen: UiLang | null = session ? langOverride[persona] ?? session.idx.user.get(PERSONAS.find((p) => p.id === persona)!.userId)!.lang : null;
  useEffect(() => { if (chosen) void useRegional.getState().ensure(chosen); }, [chosen]);
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(i); }, []);

  if (!session) return <div className="p-8 text-slate">Loading</div>;
  const userId = PERSONAS.find((p) => p.id === persona)!.userId;
  const lang: UiLang = langOverride[persona] ?? session.idx.user.get(userId)!.lang;
  const setLang = (l: UiLang) => {
    const next = { ...langOverride, [persona]: l };
    setLangOverride(next);
    try { localStorage.setItem("pakka-lang", JSON.stringify(next)); } catch { /* storage blocked */ }
  };
  const pick = (p: Persona) => { setPersona(p); setReset((x) => x + 1); };

  const body = (
    <HostProvider value={{ send }}>
      <PhoneScreens key={`${persona}|${reset}`} s={session} userId={userId} lang={lang} setLang={setLang} now={now} />
    </HostProvider>
  );

  if (embedded) return <div className="h-full">{body}</div>;
  return (
    <main className="flex min-h-screen flex-col items-center gap-3 py-4 sm:py-6">
      <div className="hidden items-center gap-2 sm:flex">
        <span className="text-[13px] text-slate">{tr("en", "persona.switch")}</span>
        {PERSONAS.map((p) => (
          <button key={p.id} onClick={() => pick(p.id)}
            className={`rounded-full px-3 py-1 text-[13px] font-semibold ${persona === p.id ? "btn-primary text-white" : "border border-line-strong text-navy"}`}>{p.label}</button>
        ))}
      </div>
      <div className="h-[100dvh] w-full overflow-hidden sm:h-[844px] sm:w-[390px] sm:rounded-[36px] sm:border-[10px] sm:border-ink">{body}</div>
      <div className="flex gap-2 sm:hidden">
        {PERSONAS.map((p) => <button key={p.id} onClick={() => pick(p.id)} className="text-[12px] text-slate underline">{p.label}</button>)}
      </div>
    </main>
  );
}

/** The phone itself: list, detail, sheets. `listTop` adds content under the list header (Pakka live uses it for
 *  messages and adding AutoPays); `confirm` replaces the PIN pad (Pakka live confirms with a passkey). */
export function PhoneScreens({ s: session, userId, lang, setLang, now, listTop, confirm, statusRight }: {
  s: Session; userId: string; lang: UiLang; setLang: (l: UiLang) => void; now: string;
  listTop?: (open: (node: ReactNode | null) => void) => ReactNode;
  confirm?: (p: { cycleId: string; choice: "pause" | "cancel"; done: (status: string) => void }) => ReactNode;
  statusRight?: ReactNode;
}) {
  const [screen, setScreen] = useState<Screen>({ name: "list" });
  const [sheet, setSheet] = useState<Sheet>(null);
  const kill = session.state.killSwitch.global;
  const openCustom = (node: ReactNode | null) => setSheet(node ? { name: "custom", node } : null);
  return (
    <div dir={langInfo(lang).rtl ? "rtl" : "ltr"} lang={langInfo(lang).sarvam} className="relative flex h-full flex-col overflow-hidden bg-canvas">
      <div className="flex h-8 items-center justify-between bg-surface px-5 text-[13px] font-semibold text-ink">
        <span className="tnum">{timeIST(now).replace(/ (AM|PM)/, "")}</span>{statusRight ?? <span className="text-slate">4G</span>}
      </div>
      <KillSwitchBanner on={kill} lang={lang} />
      {screen.name === "list" && <ListScreen s={session} userId={userId} lang={lang} now={now} setLang={setLang} top={listTop?.(openCustom)} openCustom={openCustom} open={(r) => setScreen(r.cycle.group === "collect" ? { name: "retry", mandateId: r.mandate.id } : { name: "detail", mandateId: r.mandate.id })} ask={(cycleId) => setSheet({ name: "decision", cycleId })} onFraud={(code, mandateId) => setSheet({ name: "fraud", code, mandateId })} onEscalate={() => setSheet({ name: "escalate" })} />}
      {screen.name === "detail" && <DetailScreen s={session} mandateId={screen.mandateId} lang={lang} now={now} back={() => setScreen({ name: "list" })} ask={(cycleId) => setSheet({ name: "decision", cycleId })} />}
      {screen.name === "retry" && <RetryScreen s={session} mandateId={screen.mandateId} lang={lang} now={now} back={() => setScreen({ name: "list" })} ask={(cycleId) => setSheet({ name: "decision", cycleId })} />}
      {sheet && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end">
          <button aria-label="Close" className="anim-backdrop absolute inset-0 bg-[rgba(10,25,55,.42)]" onClick={() => setSheet(null)} />
          <div role="dialog" aria-modal className="anim-sheet relative max-h-[92%] overflow-y-auto rounded-t-[28px] bg-surface px-4 pb-5 pt-2 shadow-[var(--shadow-sheet)]" onKeyDown={(e) => e.key === "Escape" && setSheet(null)}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
            {sheet.name === "decision" && <DecisionSheet s={session} cycleId={sheet.cycleId} lang={lang} now={now} onPin={(choice) => setSheet({ name: "pin", cycleId: sheet.cycleId, choice })} onDone={(choice, status) => setSheet({ name: "result", cycleId: sheet.cycleId, choice, status })} />}
            {sheet.name === "pin" && (confirm
              ? confirm({ cycleId: sheet.cycleId, choice: sheet.choice, done: (status) => setSheet({ name: "result", cycleId: sheet.cycleId, choice: sheet.choice, status }) })
              : <PinPad s={session} userId={userId} cycleId={sheet.cycleId} choice={sheet.choice} lang={lang} onDone={(status) => setSheet({ name: "result", cycleId: sheet.cycleId, choice: sheet.choice, status })} />)}
            {sheet.name === "result" && <ResultState s={session} cycleId={sheet.cycleId} choice={sheet.choice} status={sheet.status} lang={lang} now={now} close={() => setSheet(null)} />}
            {sheet.name === "fraud" && <FraudLaneSheet s={session} code={sheet.code} mandateId={sheet.mandateId} userId={userId} lang={lang} onCancel={(cycleId) => setSheet({ name: "pin", cycleId, choice: "cancel" })} />}
            {sheet.name === "escalate" && <EscalationPath lang={lang} />}
            {sheet.name === "custom" && sheet.node}
          </div>
        </div>
      )}
    </div>
  );
}

/** Read `text` aloud in `lang` with Sarvam (Bulbul), falling back to the browser's voice. */
export function ListenButton({ text, lang, onNavy = false }: { text: string; lang: UiLang; onNavy?: boolean }) {
  const [state, setState] = useState<"idle" | "busy">("idle");
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { ref.current?.pause(); }, []);
  const go = async () => {
    if (state === "busy") { ref.current?.pause(); window.speechSynthesis?.cancel(); setState("idle"); return; }
    setState("busy");
    const a = await speakWithSarvam(text, lang, () => setState("idle"));
    if (a) { ref.current = a; return; }
    const synth = window.speechSynthesis, want = langInfo(lang).sarvam.slice(0, 2);
    const voice = synth?.getVoices().find((v) => v.lang.startsWith(want));
    if (!synth || !voice) { setState("idle"); return; }
    const u = new SpeechSynthesisUtterance(text); u.voice = voice; u.lang = voice.lang; u.onend = () => setState("idle"); synth.speak(u);
  };
  return (
    <button onClick={go} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold ${onNavy ? "bg-white/20 text-white" : "btn-soft"}`}>
      {state === "busy" ? <Pause size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}{tr(lang, "sheet.listen")}
    </button>
  );
}

// ---------- C1 ----------
function ListScreen({ s, userId, lang, now, setLang, open, ask, onFraud, onEscalate, top, openCustom }: {
  s: Session; userId: string; lang: UiLang; now: string; setLang: (l: UiLang) => void; open: (r: Row) => void; ask: (cycleId: string) => void; top?: ReactNode;
  openCustom: (node: ReactNode | null) => void;
  onFraud: (code?: string, mandateId?: string) => void; onEscalate: () => void;
}) {
  const [tab, setTab] = useState<"autopay" | "mf">("autopay");
  const [customMf, setCustomMf] = useState<CustomMfFund[]>(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("pakka-demo-mf-sips") : null;
      return saved ? (JSON.parse(saved) as CustomMfFund[]) : [];
    } catch { return []; }
  });
  const addCustomMf = (f: CustomMfFund) => {
    setCustomMf((prev) => {
      const next = [...prev, f];
      try { localStorage.setItem("pakka-demo-mf-sips", JSON.stringify(next)); } catch { /* storage blocked */ }
      return next;
    });
  };
  const rows = rowsFor(s, userId).sort((a, b) => ms(a.cycle.dueAt) - ms(b.cycle.dueAt));
  const mfCount = rows.filter((r) => r.merchant.category === "mutual_fund").length + (s.world.live ? 0 : 3) + customMf.length;
  const asks = rows.filter(needsAnswer);
  const collects = rows.filter((r) => isCollect(r) && ms(r.cycle.dueAt) - ms(now) < 2 * 86_400_000);
  const soonCount = rows.filter((r) => sectionOf(r, now) === "soon" && !["skipped", "opted_out", "succeeded"].includes(r.cs.status)).length;
  const groups: { key: StringKey | "soon"; rows: Row[] }[] = [
    { key: "soon", rows: rows.filter((r) => sectionOf(r, now) === "soon") },
    { key: "section.this_month", rows: rows.filter((r) => sectionOf(r, now) === "this") },
    { key: "section.next_month", rows: rows.filter((r) => sectionOf(r, now) === "next") },
    { key: "section.interop", rows: rows.filter((r) => sectionOf(r, now) === "interop") },
  ];
  const first = asks[0] ?? collects[0];
  // The demo's line says "tomorrow"; when the asked-about charge is another day, the day is named.
  const tomorrow = asks.length > 0 && istDay(asks[0].cycle.dueAt) === istDay(addMin(now, 24 * 60));
  const cardTitle = !first ? "" : asks.length ? (tomorrow ? tr(lang, "nudge.card.title", { n: soonCount }) : tr(lang, "nudge.card.title.day", { n: soonCount, day: uiRelativeDay(asks[0].cycle.dueAt, now, lang) }))
    : first.cs.status === "failed_business" ? tr(lang, "failed.title", { amount: inr(first.cycle.amount) })
    : first.cs.status === "retry_scheduled" && first.cs.retryAt ? tr(lang, "retry.done", { when: `${uiRelativeDay(first.cs.retryAt, now, lang).toLowerCase()} ${tr(lang, "row.after", { time: "9:30 PM" })}` })
    : tr(lang, "nudge.card.collect", { brand: first.merchant.brand, amount: inr(first.cycle.amount), day: uiRelativeDay(first.cycle.dueAt, now, lang) });
  const cardSub = asks.length > 0 ? tr(lang, "nudge.card.sub", { brand: asks[0].merchant.brand, amount: inr(asks[0].cycle.amount) }) : "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 bg-surface px-4 py-3 shadow-[0_1px_0_var(--line)]">
        <ChevronLeft size={20} strokeWidth={1.8} className="text-blue" aria-hidden />
        <h1 className="flex-1 text-[20px] font-bold text-navy">{tr(lang, tab === "mf" ? "mf.title" : "list.title")}</h1>
        <LangPicker lang={lang} onChange={setLang} />
      </header>
      <div role="tablist" className="grid grid-cols-2 gap-1.5 border-b border-line bg-surface px-4 py-2">
        <button role="tab" aria-selected={tab === "autopay"} onClick={() => setTab("autopay")}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold transition-colors ${tab === "autopay" ? "btn-primary text-white" : "bg-canvas text-navy hover:bg-sky-soft/50"}`}>
          <span>{tr(lang, "tab.autopay")}</span>
          <span className={`rounded-full px-1.5 py-px text-[12px] ${tab === "autopay" ? "bg-white/20 text-white" : "bg-surface text-slate"}`}>{rows.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "mf"} onClick={() => setTab("mf")}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold transition-colors ${tab === "mf" ? "btn-primary text-white" : "bg-canvas text-navy hover:bg-sky-soft/50"}`}>
          <span>{tr(lang, "tab.mf")}</span>
          <span className={`rounded-full px-1.5 py-px text-[12px] ${tab === "mf" ? "bg-white/20 text-white" : "bg-surface text-slate"}`}>{mfCount}</span>
        </button>
      </div>
      <LangNotice lang={lang} />
      {tab === "mf" ? (
        <MutualFundsTab s={s} userId={userId} lang={lang} now={now} open={open} ask={ask} top={top} openCustom={openCustom} customMf={customMf} onAddCustomMf={addCustomMf} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-24">
          {top}
          <CaseCards s={s} userId={userId} lang={lang} now={now} onFraud={onFraud} onEscalate={onEscalate} />
          {first && (
            <div className="mx-4 mt-4 rounded-[20px] bg-gradient-to-br from-sky to-blue px-4 py-4 text-white shadow-[0_10px_24px_rgba(11,114,231,0.30)]">
              <div className="flex items-center justify-between"><PakkaSeal onNavy /><ListenButton onNavy lang={lang} text={`${cardTitle}. ${cardSub}`} /></div>
              <p className="mt-2 text-[17px] font-semibold leading-6">{cardTitle}</p>
              {cardSub && <p className="mt-1 text-[14px] text-white/80">{cardSub}</p>}
              <button onClick={() => (asks.length ? ask(asks[0].cycle.id) : open(first))} className="press mt-3 h-[38px] rounded-full bg-white px-5 text-[15px] font-semibold text-blue">{tr(lang, "nudge.card.cta")}</button>
            </div>
          )}
          {rows.length === 0 && !top && <p className="p-6 text-slate">{tr(lang, "list.empty")}</p>}
          {groups.map((g) => g.rows.length > 0 && (
            <section key={g.key}>
              <h2 className="px-5 pb-2 pt-4 text-[14px] font-semibold text-slate">
                {g.key === "soon" ? soonLabel(g.rows[0].cycle.dueAt, now, lang) : tr(lang, g.key)}
              </h2>
              <div className="card mx-4 overflow-hidden">
                {g.rows.map((r) => <MandateRow key={r.mandate.id} r={r} lang={lang} now={now} onClick={() => (needsAnswer(r) ? ask(r.cycle.id) : open(r))} />)}
              </div>
            </section>
          ))}
          <div className="flex items-start gap-2 px-4 py-4"><Info size={16} className="mt-0.5 text-mist" aria-hidden /><AIFooter lang={lang} align="left" list /></div>
        </div>
      )}
      <AskPakka s={s} userId={userId} lang={lang} onFraud={onFraud} ask={ask} onLang={setLang} />
    </div>
  );
}

interface CustomMfFund {
  id: string;
  brand: string;
  legalName: string;
  tile: { bg: string; fg: string };
  amount: number;
  interval: "month" | "quarter" | "year";
  nextDue: string;
}

interface MfInstallment {
  id: string;
  fundId: string;
  brand: string;
  legalName: string;
  tile: { bg: string; fg: string };
  amount: number;
  interval: "month" | "quarter" | "year";
  dueAt: string;
  dayIso: string;
  pill: { kind: "answer" | "neutral" | "done" | "muted" | "fraud"; key: string } | null;
  activeOutflow: boolean;
  row?: Row;
}

const DEMO_MF_FUNDS: { id: string; brand: string; legalName: string; tile: { bg: string; fg: string }; amount: number; dayOfMonth: string }[] = [
  { id: "demo_mf_flexi", brand: "Parag Flexi Cap Direct", legalName: "PPFAS Asset Management Pvt Ltd", tile: { bg: "#E6EEF9", fg: "#2D5C9E" }, amount: 500000, dayOfMonth: "05" },
  { id: "demo_mf_nifty", brand: "Bharat Nifty 50 Index", legalName: "UTI Mutual Fund AMC Ltd", tile: { bg: "#E3F1E6", fg: "#2E6B3A" }, amount: 350000, dayOfMonth: "15" },
  { id: "demo_mf_midcap", brand: "Pragati Midcap Direct", legalName: "HDFC Asset Management Co Ltd", tile: { bg: "#FCE8EF", fg: "#9A2C55" }, amount: 250000, dayOfMonth: "22" },
];

const MF_TILES: { bg: string; fg: string }[] = [
  { bg: "#EFE8F7", fg: "#5B3A8C" },
  { bg: "#E6EEF9", fg: "#2D5C9E" },
  { bg: "#E3F1E6", fg: "#2E6B3A" },
  { bg: "#FCE8EF", fg: "#9A2C55" },
  { bg: "#FFF0DC", fg: "#8A5300" },
];

function MutualFundsTab({ s, userId, lang, now, open, ask, top, openCustom, customMf, onAddCustomMf }: {
  s: Session; userId: string; lang: UiLang; now: string; open: (r: Row) => void; ask: (cycleId: string) => void; top?: ReactNode;
  openCustom: (node: ReactNode | null) => void;
  customMf: CustomMfFund[];
  onAddCustomMf: (f: CustomMfFund) => void;
}) {
  const todayIso = istDay(now);
  const [preset, setPreset] = useState<"all" | "this_month" | "next_30" | "next_90" | "custom">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const applyPreset = (p: typeof preset) => {
    setPreset(p);
    if (p === "all") {
      setFromDate("");
      setToDate("");
    } else if (p === "this_month") {
      const ym = todayIso.slice(0, 7);
      const [y, m] = ym.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      setFromDate(`${ym}-01`);
      setToDate(`${ym}-${String(last).padStart(2, "0")}`);
    } else if (p === "next_30") {
      setFromDate(todayIso);
      setToDate(new Date(ms(ist(`${todayIso} 12:00`)) + 30 * 86_400_000).toISOString().slice(0, 10));
    } else if (p === "next_90") {
      setFromDate(todayIso);
      setToDate(addMonths(todayIso, 3));
    }
  };

  const allItems = useMemo<MfInstallment[]>(() => {
    const out: MfInstallment[] = [];
    const userRows = rowsFor(s, userId).filter((r) => r.merchant.category === "mutual_fund");
    const stepOf = { month: 1, quarter: 3, year: 12 } as const;

    for (const r of userRows) {
      const m = r.mandate;
      const mer = r.merchant;
      const plan = r.plan;
      const revoked = s.state.mandateStatus.get(m.id) === "revoked";
      const cycles = [...(s.idx.cyclesByMandate.get(m.id) ?? [])].sort((a, b) => a.seq - b.seq);
      const seenDays = new Set<string>();
      for (const c of cycles) {
        const cs = s.state.cycle(c.id);
        const dueAt = cs.dueOverride ?? c.dueAt;
        const dayIso = istDay(dueAt);
        seenDays.add(dayIso);
        const rowForCycle: Row = { mandate: m, merchant: mer, plan, cycle: c, cs, user: r.user };
        const pill = pillFor(rowForCycle) ?? { kind: "neutral" as const, key: "pill.scheduled" };
        const activeOutflow = !revoked && !["skipped", "opted_out"].includes(cs.status);
        out.push({
          id: c.id, fundId: m.id, brand: mer.brand, legalName: mer.legalName, tile: mer.tile,
          amount: cs.amountOverride ?? c.amount, interval: plan.interval, dueAt, dayIso, pill, activeOutflow, row: r,
        });
      }
      // Project upcoming SIP dates up to 3 installments ahead so multi-month date filters show future SIP debits
      if (!revoked && cycles.length > 0) {
        const baseDay = istDay(r.cs.dueOverride ?? r.cycle.dueAt);
        for (let k = 1; k <= 3; k++) {
          const nextDay = addMonths(baseDay, k * stepOf[plan.interval]);
          if (seenDays.has(nextDay)) continue;
          seenDays.add(nextDay);
          const dueAt = ist(`${nextDay} 10:00`);
          out.push({
            id: `${m.id}_proj_${k}`, fundId: m.id, brand: mer.brand, legalName: mer.legalName, tile: mer.tile,
            amount: r.cs.amountOverride ?? r.cycle.amount, interval: plan.interval, dueAt, dayIso: nextDay,
            pill: { kind: "neutral", key: "pill.scheduled" }, activeOutflow: true, row: r,
          });
        }
      }
    }

    // In demo mode, include realistic multi-fund SIP installments across Oct, Nov, Dec 2026
    if (!s.world.live) {
      const baseMonth = todayIso.slice(0, 7);
      for (const df of DEMO_MF_FUNDS) {
        for (let mOff = 0; mOff < 3; mOff++) {
          const dayIso = addMonths(`${baseMonth}-${df.dayOfMonth}`, mOff);
          const dueAt = ist(`${dayIso} 10:00`);
          const charged = dayIso < todayIso;
          out.push({
            id: `${df.id}_${dayIso}`, fundId: df.id, brand: df.brand, legalName: df.legalName, tile: df.tile,
            amount: df.amount, interval: "month", dueAt, dayIso,
            pill: { kind: charged ? "done" : "neutral", key: charged ? "pill.charged" : "pill.scheduled" },
            activeOutflow: true,
          });
        }
      }
    }

    // Include any custom SIP funds added in demo mode
    for (const cf of customMf) {
      for (let mOff = 0; mOff < 4; mOff++) {
        const dayIso = addMonths(cf.nextDue, mOff * stepOf[cf.interval]);
        const dueAt = ist(`${dayIso} 10:00`);
        const charged = dayIso < todayIso;
        out.push({
          id: `${cf.id}_${dayIso}`, fundId: cf.id, brand: cf.brand, legalName: cf.legalName, tile: cf.tile,
          amount: cf.amount, interval: cf.interval, dueAt, dayIso,
          pill: { kind: charged ? "done" : "neutral", key: charged ? "pill.charged" : "pill.scheduled" },
          activeOutflow: true,
        });
      }
    }

    return out.sort((a, b) => (a.dayIso < b.dayIso ? -1 : a.dayIso > b.dayIso ? 1 : a.brand.localeCompare(b.brand)));
  }, [s, userId, todayIso, customMf]);

  const filtered = useMemo(() => {
    return allItems.filter((item) => {
      if (fromDate && item.dayIso < fromDate) return false;
      if (toDate && item.dayIso > toDate) return false;
      return true;
    });
  }, [allItems, fromDate, toDate]);

  const totalPaise = useMemo(() => filtered.reduce((sum, x) => sum + (x.activeOutflow ? x.amount : 0), 0), [filtered]);

  const byFund = useMemo(() => {
    const map = new Map<string, { fundId: string; brand: string; legalName: string; tile: { bg: string; fg: string }; total: number; count: number; interval: "month" | "quarter" | "year"; row?: Row }>();
    for (const item of filtered) {
      const cur = map.get(item.fundId) ?? { fundId: item.fundId, brand: item.brand, legalName: item.legalName, tile: item.tile, total: 0, count: 0, interval: item.interval, row: item.row };
      if (item.activeOutflow) {
        cur.total += item.amount;
        cur.count += 1;
      }
      map.set(item.fundId, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [filtered]);

  const presets: { id: typeof preset; label: StringKey }[] = [
    { id: "all", label: "mf.filter.all" },
    { id: "this_month", label: "mf.filter.this_month" },
    { id: "next_30", label: "mf.filter.next_30" },
    { id: "next_90", label: "mf.filter.next_90" },
  ];

  const openAddSip = () => openCustom(
    <AddMfSipSheet s={s} lang={lang} todayIso={todayIso} onAddCustomMf={onAddCustomMf} close={() => openCustom(null)} />
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-24">
      <div className="mx-4 mt-3 flex items-center justify-between gap-2">
        <p className="text-[14px] font-semibold text-slate">{tr(lang, "mf.sub")}</p>
        <button onClick={openAddSip} className="press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full btn-primary px-4 text-[14.5px] font-semibold text-white">
          <Plus size={16} aria-hidden />{tr(lang, "mf.add")}
        </button>
      </div>

      <div className="mx-4 mt-2.5 flex flex-col gap-2.5 rounded-[16px] border border-line bg-surface p-3.5 shadow-[0_2px_8px_rgba(10,25,55,0.04)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p.id} onClick={() => applyPreset(p.id)}
                className={`rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors ${preset === p.id ? "btn-primary text-white" : "border border-line-strong bg-canvas text-navy"}`}>
                {tr(lang, p.label)}
              </button>
            ))}
          </div>
          {(fromDate || toDate) && (
            <button onClick={() => applyPreset("all")} className="shrink-0 text-[12.5px] font-semibold text-blue underline">
              {tr(lang, "mf.filter.clear")}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <label className="flex flex-col gap-0.5 text-[12px] font-semibold text-slate">
            {tr(lang, "mf.filter.from")}
            <input type="date" value={fromDate} onChange={(e) => { setPreset("custom"); setFromDate(e.target.value); }}
              className="h-9 rounded-[8px] border border-line-strong bg-canvas px-2.5 text-[13px] font-normal text-ink" />
          </label>
          <label className="flex flex-col gap-0.5 text-[12px] font-semibold text-slate">
            {tr(lang, "mf.filter.to")}
            <input type="date" value={toDate} onChange={(e) => { setPreset("custom"); setToDate(e.target.value); }}
              className="h-9 rounded-[8px] border border-line-strong bg-canvas px-2.5 text-[13px] font-normal text-ink" />
          </label>
        </div>
      </div>

      <div className="mx-4 mt-3 rounded-[20px] bg-gradient-to-br from-navy to-blue px-4 py-4 text-white shadow-[0_10px_24px_rgba(11,114,231,0.24)]">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-white/80">{tr(lang, "mf.total")}</span>
          <ListenButton onNavy lang={lang} text={`${tr(lang, "mf.total")}: ${inr(totalPaise)}. ${tr(lang, "mf.funds_count", { funds: byFund.length, txns: filtered.length })}`} />
        </div>
        <div className="mt-1 tnum text-[28px] font-extrabold leading-8">{inr(totalPaise)}</div>
        <p className="mt-1 text-[13.5px] text-white/85">
          {tr(lang, "mf.funds_count", { funds: byFund.length, txns: filtered.length })}
          {(fromDate || toDate) ? ` (${fromDate || "..."} to ${toDate || "..."})` : ""}
        </p>
      </div>

      {byFund.length > 0 && (
        <section className="mx-4 mt-4">
          <h2 className="pb-2 text-[14px] font-semibold text-slate">{tr(lang, "mf.where_title")}</h2>
          <div className="card divide-y divide-line overflow-hidden">
            {byFund.map((f) => {
              const pct = totalPaise > 0 ? Math.round((f.total / totalPaise) * 100) : 0;
              return (
                <div key={f.fundId} onClick={() => f.row && (needsAnswer(f.row) ? ask(f.row.cycle.id) : open(f.row))}
                  className={`flex flex-col gap-1.5 px-4 py-3 ${f.row ? "cursor-pointer hover:bg-canvas" : ""}`}>
                  <div className="flex items-center gap-3">
                    <MerchantTile brand={f.brand} tile={f.tile} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-ink">{f.brand}</div>
                      <div className="truncate text-[12.5px] text-slate">{f.legalName}</div>
                    </div>
                    <div className="text-right">
                      <div className="tnum text-[15.5px] font-bold text-navy">{inr(f.total)}</div>
                      <div className="tnum text-[12px] font-semibold text-blue">{pct}% ({f.count}x)</div>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
                    <div className="h-full rounded-full bg-blue transition-all" style={{ width: `${Math.max(pct, 4)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mx-4 mt-4">
        <h2 className="pb-2 text-[14px] font-semibold text-slate">{tr(lang, "mf.schedule_title")}</h2>
        {filtered.length === 0 ? (
          <p className="card p-5 text-center text-[14.5px] text-slate">{tr(lang, "mf.empty")}</p>
        ) : (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1.5fr_0.9fr_1fr] items-center border-b border-line bg-canvas px-3.5 py-2 text-[12px] font-bold uppercase tracking-wide text-slate">
              <span>{tr(lang, "mf.col.fund")}</span>
              <span>{tr(lang, "mf.col.date")}</span>
              <span className="text-right">{tr(lang, "mf.col.amount")}</span>
            </div>
            <div className="divide-y divide-line">
              {filtered.map((item) => (
                <div key={item.id} onClick={() => item.row && (needsAnswer(item.row) ? ask(item.row.cycle.id) : open(item.row))}
                  className={`grid grid-cols-[1.5fr_0.9fr_1fr] items-center gap-2 px-3.5 py-3 text-left transition-colors ${item.row ? "cursor-pointer hover:bg-canvas active:bg-sky-soft/60" : ""}`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <MerchantTile brand={item.brand} tile={item.tile} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-semibold text-ink">{item.brand}</div>
                      <div className="truncate text-[12px] text-slate">{item.legalName}</div>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="tnum text-[13.5px] font-semibold text-navy">{uiDayMonth(item.dueAt, lang)}</span>
                    <span className="text-[11.5px] text-slate">{uiRelativeDay(item.dueAt, now, lang)}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Amount paise={item.amount} lang={lang} />
                    {item.pill && <StatusPill kind={item.pill.kind}>{tr(lang, item.pill.key as StringKey)}</StatusPill>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      <div className="flex items-start gap-2 px-4 py-4"><Info size={16} className="mt-0.5 text-mist" aria-hidden /><AIFooter lang={lang} align="left" list /></div>
    </div>
  );
}

const SAMPLE_SIP_SMS = "Dear Investor, your UPI AutoPay SIP mandate for Nippon Small Cap Fund of Rs.4,500.00 monthly to Nippon Life India Asset Management Ltd was created on 18-10-2026. -HDFC Bank";

function parseSipSmsClient(text: string, today: string) {
  const amountMatch = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text)?.[1];
  const amount = amountMatch ? Number(amountMatch.replace(/,/g, "")) : null;
  const legal = /((?:[A-Z][A-Za-z0-9&']*\s+){1,7}(?:Pvt\.?\s*Ltd|Private Limited|Limited|Ltd))/.exec(text)?.[1]?.trim() ?? null;
  const named = /(?:for|towards)\s+([A-Z][A-Za-z0-9]*(?:\s[A-Z][A-Za-z0-9]*){0,5})\b/.exec(text)?.[1]?.trim() ?? null;
  const brand = named && !(legal ?? "").startsWith(named) ? named : null;
  const interval: "month" | "quarter" | "year" = /\bquarter/i.test(text) ? "quarter" : /\b(year|yearly|annual)/i.test(text) ? "year" : "month";
  const m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/.exec(text);
  let nextDue = addMonths(today, 1);
  if (m) {
    const d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (d > today) nextDue = d;
    else {
      let next = addMonths(d, 1);
      while (next <= today) next = addMonths(next, 1);
      nextDue = next;
    }
  }
  return { brand, legalName: legal, amount, interval, nextDue };
}

function AddMfSipSheet({ s, lang, todayIso, onAddCustomMf, close }: {
  s: Session; lang: UiLang; todayIso: string; onAddCustomMf: (f: CustomMfFund) => void; close: () => void;
}) {
  const [sms, setSms] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [f, setF] = useState({
    brand: "",
    legalName: "",
    amount: "",
    interval: "month" as "month" | "quarter" | "year",
    nextDue: addMonths(todayIso, 1),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const fromSms = async (textToRead = sms) => {
    if (!textToRead.trim()) return;
    setBusy(true);
    setNote(null);
    if (s.world.live) {
      const r = await useLive.getState().readSms(textToRead);
      setBusy(false);
      if (!("error" in r)) {
        const d = r.draft;
        setF((x) => ({
          ...x,
          brand: d.brand ?? x.brand,
          legalName: d.legalName ?? x.legalName,
          amount: d.amount ? String(d.amount / 100) : x.amount,
          interval: d.interval ?? x.interval,
          nextDue: d.nextDue ?? x.nextDue,
        }));
        setNote(tr(lang, r.found ? "live.sms.found" : "live.sms.none"));
        return;
      }
    }
    const parsed = parseSipSmsClient(textToRead, todayIso);
    setBusy(false);
    setF((x) => ({
      ...x,
      brand: parsed.brand ?? x.brand,
      legalName: parsed.legalName ?? x.legalName,
      amount: parsed.amount ? String(parsed.amount) : x.amount,
      interval: parsed.interval,
      nextDue: parsed.nextDue,
    }));
    setNote(tr(lang, parsed.brand || parsed.amount ? "live.sms.found" : "live.sms.none"));
  };

  const amountPaise = Math.round((Number(f.amount.replace(/[,\s₹]/g, "")) || 0) * 100);
  const ok = f.brand.trim().length > 0 && amountPaise >= 100 && /^\d{4}-\d{2}-\d{2}$/.test(f.nextDue);

  const save = async () => {
    if (!ok) return;
    setBusy(true);
    setErr(null);
    if (s.world.live) {
      const e = await useLive.getState().addAutopay({
        brand: f.brand.trim(),
        legalName: f.legalName.trim() || f.brand.trim(),
        kind: "sip",
        amount: amountPaise,
        interval: f.interval,
        nextDue: f.nextDue,
        trial: null,
        source: sms.trim() ? "sms" : "typed",
      });
      setBusy(false);
      if (e) { setErr(e); return; }
      close();
      return;
    }
    const tile = MF_TILES[Math.floor(Math.random() * MF_TILES.length)];
    onAddCustomMf({
      id: `custom_mf_${Date.now()}`,
      brand: f.brand.trim(),
      legalName: f.legalName.trim() || f.brand.trim(),
      tile,
      amount: amountPaise,
      interval: f.interval,
      nextDue: f.nextDue,
    });
    setBusy(false);
    close();
  };

  const field = "h-11 rounded-[8px] border border-line-strong bg-surface px-3 text-[16px] font-normal";
  const label = "flex flex-col gap-1 text-[14px] font-semibold text-ink";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[20px] font-bold text-navy">{tr(lang, "mf.add.title")}</h2>
        <button type="button" onClick={() => { setSms(SAMPLE_SIP_SMS); void fromSms(SAMPLE_SIP_SMS); }}
          className="rounded-full bg-sky-soft px-3 py-1 text-[12.5px] font-semibold text-blue">
          {tr(lang, "mf.sample_sms")}
        </button>
      </div>
      <label className={label}>{tr(lang, "live.sms")}
        <textarea value={sms} onChange={(e) => setSms(e.target.value)} rows={3} maxLength={800} className="rounded-[8px] border border-line-strong p-3 text-[14.5px] font-normal" />
      </label>
      <button type="button" disabled={busy || !sms.trim()} onClick={() => void fromSms(sms)} className="h-10 rounded-full border border-line-strong text-[14.5px] font-semibold text-navy disabled:text-mist">
        {busy ? tr(lang, "button.working") : tr(lang, "live.sms.read")}
      </button>
      {note && <p role="status" className="rounded-[10px] bg-canvas px-3 py-2 text-[13.5px] text-slate">{note}</p>}
      <label className={label}>{tr(lang, "mf.f.fund")}<input value={f.brand} onChange={(e) => set("brand", e.target.value)} maxLength={40} className={field} /></label>
      <label className={label}>{tr(lang, "mf.f.amc")}<input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} maxLength={80} className={field} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>{tr(lang, "live.f.amount")}<input value={f.amount} onChange={(e) => set("amount", e.target.value)} inputMode="decimal" className={field} /></label>
        <label className={label}>{tr(lang, "live.f.due")}<input type="date" value={f.nextDue} onChange={(e) => set("nextDue", e.target.value)} className={field} /></label>
      </div>
      <label className={label}>{tr(lang, "live.f.interval")}
        <select value={f.interval} onChange={(e) => set("interval", e.target.value as "month" | "quarter" | "year")} className={field}>
          {(["month", "quarter", "year"] as const).map((k) => <option key={k} value={k}>{tr(lang, `live.f.${k}` as StringKey)}</option>)}
        </select>
      </label>
      {err && <p role="alert" className="text-[14px] text-red">{tr(lang, "live.err.generic")}</p>}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button type="button" onClick={close} className="h-12 rounded-full border border-line-strong text-[16px] font-semibold text-navy">{tr(lang, "live.notnow")}</button>
        <button type="button" disabled={busy || !ok} onClick={() => void save()} className="h-12 rounded-full btn-primary text-[16px] font-semibold text-white disabled:bg-line-strong disabled:text-slate">{busy ? tr(lang, "button.working") : tr(lang, "live.save")}</button>
      </div>
    </div>
  );
}

/** "Kal, 27 Oct", or just "27 Oct" when the day is already a date (past or far off). */
function LangNotice({ lang }: { lang: UiLang }) {
  const status = useRegional((x) => x.status[lang]);
  if (!isRegional(lang) || hasTable(lang) || !status) return null;
  const base = baseLang(lang);
  return <p role="status" className="bg-amber-wash px-4 py-2 text-[13.5px] text-amber">{status === "loading" ? tr(base, "lang.loading", { lang: langInfo(lang).native }) : tr(base, "lang.unavailable", { lang: langInfo(lang).native, base: langInfo(base).native })}</p>;
}

function soonLabel(dueAt: string, now: string, lang: UiLang) {
  const rel = uiRelativeDay(dueAt, now, lang);
  const date = uiDayMonth(dueAt, lang);
  return rel === date ? date : `${rel}, ${date}`;
}

function MandateRow({ r, lang, now, onClick }: { r: Row; lang: UiLang; now: string; onClick: () => void }) {
  const pill = pillFor(r);
  const soon = sectionOf(r, now) === "soon";
  const sub = r.mandate.irrevocable ? tr(lang, "row.irrevocable") : r.mandate.visibleViaInterop ? tr(lang, "row.interop") : soon ? tr(lang, "row.after", { time: "9:30 PM" }) : tr(lang, "row.monthly");
  return (
    <button onClick={onClick} className="flex min-h-12 w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-canvas active:bg-sky-soft/60">
      <MerchantTile brand={r.merchant.brand} tile={r.merchant.tile} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold">{r.merchant.brand}{r.merchant.category === "loan" ? " EMI" : ""}</div>
        <div className="flex items-center gap-1 text-[14px] text-slate">{r.mandate.irrevocable && <Lock size={16} strokeWidth={1.8} aria-hidden />}<span className="truncate">{sub}</span></div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Amount paise={r.cs.amountOverride ?? r.cycle.amount} lang={lang} />
        {pill ? <StatusPill kind={pill.kind}>{tr(lang, pill.key as StringKey)}</StatusPill> : <span className="text-[14px] text-slate">{uiDayMonth(r.cycle.dueAt, lang)}</span>}
      </div>
    </button>
  );
}

// ---------- C2 ----------
function choiceLabel(lang: UiLang, c: Choice, amountFor?: string, pauseAsSkip?: boolean) {
  return tr(lang, c === "keep" ? "choice.keep" : c === "skip" ? "choice.skip" : c === "pause" ? (pauseAsSkip ? "choice.skip.month" : "choice.pause") : c === "cancel" ? "choice.cancel" : "choice.downgrade", { amount: amountFor ?? "" });
}

function DecisionSheet({ s, cycleId, lang, now, onPin, onDone }: { s: Session; cycleId: string; lang: UiLang; now: string; onPin: (c: "pause" | "cancel") => void; onDone: (c: Choice, status: string) => void }) {
  const { send, confirmTag } = useHost();
  const c = s.idx.cycle.get(cycleId)!;
  const cs = s.state.cycle(cycleId);
  const m = s.idx.mandate.get(c.mandateId)!;
  const mer = s.idx.merchant.get(m.merchantId)!;
  const plan = s.idx.plan.get(m.planId)!;
  const settings = s.settings(mer.id);
  const usage = s.idx.usage.get(m.id);
  const cheaper = settings.offerDowngradePlanId ? s.idx.plan.get(settings.offerDowngradePlanId) : undefined;
  const maxSkips = maxSkipsAllowed();
  const skipsUsed = s.state.skipsUsed(m.id);
  const pauseWillCancel = skipsUsed >= maxSkips;
  const nextMonthIso = ist(`${addMonths(istDay(cs.dueOverride ?? c.dueAt), 1)} 22:00`);
  const nextDate = uiDayMonth(nextMonthIso, lang);
  const label = (ch: Choice) => choiceLabel(lang, ch, cheaper ? inr(cheaper.amount) : undefined, !pauseWillCancel);
  const [choice, setChoice] = useState<Choice | null>(cs.decision ?? null);
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audioRef.current?.pause(); window.speechSynthesis?.cancel(); }, []);
  const day = uiRelativeDay(cs.dueOverride ?? c.dueAt, now, lang);
  const amount = inr(cs.amountOverride ?? c.amount);
  const p = { day, amount, brand: mer.brand, trialDate: m.trialStartedAt ? uiDayMonth(m.trialStartedAt, lang) : "", trialAmount: plan.trialAmount ? inr(plan.trialAmount) : "" };
  const lede = c.firstAfterTrial && m.trialStartedAt
    ? tr(lang, m.usageConsent && usage && !usage.openedSinceTrial ? "sheet.lede.trial_unused" : "sheet.lede.trial", p)
    : tr(lang, "sheet.lede.first");
  const dh = cs.askRule === "DH_ASK_V1";
  const options: { id: Choice; desc: string; offer?: boolean; pin?: boolean }[] = [
    { id: "keep", desc: tr(lang, "choice.keep.desc", p) },
    ...(settings.offerSkip ? [{ id: "skip" as Choice, desc: tr(lang, "choice.skip.desc"), offer: true }] : []),
    ...(cheaper ? [{ id: "downgrade" as Choice, desc: tr(lang, "choice.downgrade.desc", { amount: inr(cheaper.amount) }), offer: true }] : []),
    { id: "pause", desc: pauseWillCancel ? tr(lang, "choice.pause.warn_cancel", { brand: mer.brand, max: maxSkips }) : tr(lang, "choice.skip.month.desc", { next: nextDate }), pin: true },
    { id: "cancel", desc: tr(lang, "choice.cancel.desc", p), pin: true },
  ];
  const listen = async () => {
    if (audio === "playing" || audio === "loading") { window.speechSynthesis?.cancel(); audioRef.current?.pause(); setAudio("idle"); return; }
    // What the customer hears: the title, the first line and the name on the bank SMS, in their language.
    const script = `${tr(lang, "sheet.title", p)}. ${lede} ${tr(lang, "namegap", { legal: mer.legalName, brand: mer.brand })}`;
    // Sunita's PadhoAI reminder has a recorded Hindi note; everything else is spoken by Sarvam's Bulbul.
    if (lang === "hi" && m.userId === "u_sunita" && mer.id === "m_padhoai") {
      const a = new Audio("/audio/sunita-padhoai-hi.m4a");
      audioRef.current = a;
      a.onended = () => setAudio("idle");
      if (await a.play().then(() => true, () => false)) { setAudio("playing"); return; }
    }
    setAudio("loading");
    const sarvam = await speakWithSarvam(script, lang, () => setAudio("idle"));
    if (sarvam) { audioRef.current = sarvam; setAudio("playing"); return; }
    // No Sarvam key or no network: the browser's own voice for this language, else Hindi.
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const want = langInfo(lang).sarvam.slice(0, 2);
    const voice = synth?.getVoices().find((v) => v.lang.startsWith(want)) ?? synth?.getVoices().find((v) => v.lang.startsWith("hi"));
    if (!synth || !voice) { setAudio("error"); return; }
    const u = new SpeechSynthesisUtterance(voice.lang.startsWith(want) ? script : `${tr("hi", "sheet.title", { ...p, day: uiRelativeDay(c.dueAt, now, "hi") })}. ${tr("hi", "namegap", { legal: mer.legalName, brand: mer.brand })}`);
    u.voice = voice; u.lang = voice.lang; u.onend = () => setAudio("idle");
    synth.speak(u); setAudio("playing");
  };
  const confirm = async () => {
    if (!choice) return;
    if (choice === "pause" || choice === "cancel") return onPin(choice);
    setBusy(true);
    const r = (await send({ kind: "customer_decision", cycleId, choice })) as { status: string; reason?: string } | null;
    setBusy(false);
    onDone(choice, r?.reason === "KILL_SWITCH_V1" ? "held" : r?.status ?? "executed");
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <PakkaSeal />
        <button onClick={listen} className="btn-soft inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-semibold">
          {audio === "playing" || audio === "loading" ? <Pause size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}{tr(lang, "sheet.listen")}
        </button>
      </div>
      {audio === "error" && <p className="text-[14px] text-slate">{tr(lang, "voice.error")}</p>}
      <h2 className="text-[23px] font-bold leading-7 text-navy">{tr(lang, "sheet.title", p)}</h2>
      <p className="text-[16px] text-slate">{lede}</p>
      <DebitTimeline startMs={ms(cs.noticeAt ?? c.noticeAt)} endMs={ms(addMin(c.dueAt, -130))} nowMs={ms(now)}
        left={[`${uiRelativeDay(cs.noticeAt ?? c.noticeAt, now, lang)} ${timeIST(cs.noticeAt ?? c.noticeAt)}`, tr(lang, "timeline.now")]}
        right={[`${day} ${tr(lang, "timeline.after", { time: "9:30 PM" })}`, tr(lang, "timeline.end", { amount })]}
        ariaLabel={`${timeIST(cs.noticeAt ?? c.noticeAt)} to ${day} 9:30 PM`} />
      {hasNameGap(mer.brand, mer.legalName) && mer.brandVerified && (
        <div className="flex gap-2 rounded-[10px] bg-canvas px-3 py-2.5 text-[14px]">
          <ShieldCheck size={20} strokeWidth={1.8} className="shrink-0 text-green" aria-hidden />
          <span>{tr(lang, "namegap", { legal: mer.legalName, brand: mer.brand }).split(mer.legalName).flatMap((x, i, a) => (i < a.length - 1 ? [x, <b key={i}>{mer.legalName}</b>] : [x]))}</span>
        </div>
      )}
      {cs.decision && <p className="text-[14px] text-slate">{tr(lang, "sheet.changed", { choice: label(cs.decision) })}</p>}
      <h3 className="text-[17px] font-semibold">{tr(lang, "sheet.question")}</h3>
      <div role="radiogroup" className="flex flex-col gap-2">
        {options.map((o) => {
          const sel = choice === o.id;
          return (
            <label key={o.id} className={`flex cursor-pointer gap-3 rounded-[14px] border px-3 py-[9px] transition-all duration-[120ms] ${sel ? "border-blue bg-sky-soft/50 shadow-[0_0_0_1px_var(--blue)]" : "border-line-strong bg-surface hover:border-blue/50"}`}>
              <input type="radio" name="choice" className="sr-only" checked={sel} onChange={() => setChoice(o.id)} />
              <span aria-hidden className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${sel ? "border-[6px] border-blue" : "border-line-strong"}`} />
              <span className="flex-1">
                <span className="block text-[16px] font-semibold">{label(o.id)}</span>
                <span className="block text-[14px] text-slate">{o.desc}</span>
                {(o.offer || o.pin) && (
                  <span className="mt-1 flex items-center gap-1 text-[13px] text-slate">
                    {o.offer && <span className="rounded-full bg-offer-wash px-2 py-px text-[12.5px] font-semibold text-offer">{tr(lang, "tag.offer", { brand: mer.brand })}</span>}
                    {o.pin && <><Lock size={16} strokeWidth={1.8} aria-hidden />{tr(lang, confirmTag ?? "tag.pin")}</>}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {pauseWillCancel && choice === "pause" && (
        <p role="alert" className="rounded-[10px] bg-red-wash px-3 py-2 text-[14px] font-semibold text-red">
          {tr(lang, "choice.pause.warn_cancel", { brand: mer.brand, max: maxSkips })}
        </p>
      )}
      <p className="flex gap-2 text-[14px] text-slate"><Info size={18} className="shrink-0" aria-hidden />{tr(lang, dh ? "noanswer.dh" : "noanswer.default", p)}</p>
      <button disabled={!choice || busy} onClick={confirm} className={`h-12 rounded-[10px] text-[16px] font-semibold ${choice ? "btn-primary text-white" : "bg-line-strong text-slate"}`}>
        {busy ? tr(lang, "button.working") : choice ? (choice === "pause" && pauseWillCancel ? tr(lang, "choice.cancel") : label(choice)) : tr(lang, "button.choose")}
      </button>
      <AIFooter lang={lang} />
    </div>
  );
}

// ---------- C3 ----------
function PinPad({ s, userId, cycleId, choice, lang, onDone }: { s: Session; userId: string; cycleId: string; choice: "pause" | "cancel"; lang: UiLang; onDone: (status: string) => void }) {
  const { send } = useHost();
  const [digits, setDigits] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const c = s.idx.cycle.get(cycleId)!;
  const brand = s.merchantOf(c.mandateId).brand;
  const pauseWillCancel = choice === "pause" && s.state.skipsUsed(c.mandateId) >= maxSkipsAllowed();
  // In production this is NPCI's common library PIN screen; the app never sees the PIN.
  const submit = async () => {
    setBusy(true);
    const r = (await send({ kind: "pin", userId, digits })) as { pinToken?: string } | null;
    if (!r?.pinToken) { setErr(true); setDigits(""); setBusy(false); return; }
    const d = (await send({ kind: "customer_decision", cycleId, choice, pinToken: r.pinToken })) as { status: string } | null;
    setBusy(false);
    onDone(d?.status ?? "executed");
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="rounded-full bg-amber-wash px-3 py-0.5 text-[13px] font-semibold text-amber">{tr(lang, "pin.demo")}</p>
      <h2 className="text-[20px] font-bold text-navy">{tr(lang, "pin.title")}</h2>
      <p className="text-[14px] text-slate">{tr(lang, choice === "pause" && !pauseWillCancel ? "pin.what.pause" : "pin.what.cancel", { brand })}</p>
      {pauseWillCancel && <p role="alert" className="rounded-[10px] bg-red-wash px-3 py-2 text-center text-[14px] font-semibold text-red">{tr(lang, "choice.pause.warn_cancel", { brand, max: maxSkipsAllowed() })}</p>}
      <div className="flex gap-3" aria-label={`${digits.length} digits entered`}>
        {Array.from({ length: 6 }, (_, i) => <span key={i} className={`h-3 w-3 rounded-full ${i < digits.length ? "bg-navy" : "border border-line-strong"}`} />)}
      </div>
      {err && <p className="text-[14px] text-red">{tr(lang, "pin.wrong")}</p>}
      <div className="grid w-full grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k) => k === "" ? <span key="blank" /> : (
          <button key={k} onClick={() => { setErr(false); setDigits((d) => (k === "del" ? d.slice(0, -1) : d.length < 6 ? d + k : d)); }}
            className="h-12 rounded-[10px] border border-line text-[20px] font-semibold text-ink" aria-label={k === "del" ? "Delete" : k}>{k === "del" ? <X size={20} className="mx-auto" /> : k}</button>
        ))}
      </div>
      <button disabled={busy || !(digits.length === 4 || digits.length === 6)} onClick={submit} className="h-12 w-full rounded-full btn-primary text-[16px] font-semibold text-white disabled:bg-line-strong disabled:text-slate">
        {busy ? tr(lang, "button.working") : tr(lang, "button.ok")}
      </button>
    </div>
  );
}

// ---------- C4 ----------
function ResultState({ s, cycleId, choice, status, lang, now, close }: { s: Session; cycleId: string; choice: Choice; status: string; lang: UiLang; now: string; close: () => void }) {
  const c = s.idx.cycle.get(cycleId)!;
  const cs = s.state.cycle(cycleId);
  const mer = s.merchantOf(c.mandateId);
  const nextIso = ist(`${addMonths(istDay(c.dueAt), 1)} 22:00`);
  const p = { day: uiRelativeDay(c.dueAt, now, lang), amount: inr(c.amount), brand: mer.brand, next: uiDayMonth(nextIso, lang) };
  const verified = (choice === "skip" && cs.status === "skipped") || (choice === "keep" && cs.status === "confirmed") || ((choice === "pause" || choice === "cancel") && cs.status === "opted_out") || (choice === "downgrade" && !!cs.amountOverride);
  const cancelledOnPause = choice === "pause" && (cs.optOutKind === "cancel" || s.state.mandateStatus.get(c.mandateId) === "revoked");
  let title: string, sub = "";
  if (status === "held") title = tr(lang, "result.held");
  else if (status === "late") title = tr(lang, "result.late");
  else if (!verified) { title = tr(lang, "button.slow"); }
  else if (choice === "skip" || (choice === "pause" && !cancelledOnPause)) { title = tr(lang, "result.skip", p); sub = tr(lang, "result.skip.sub", p); }
  else if (choice === "keep") { title = tr(lang, "result.keep", p); sub = tr(lang, "result.keep.sub", p); }
  else if (choice === "downgrade") {
    const newDue = cs.dueOverride ?? c.dueAt;
    title = tr(lang, "result.downgrade", { ...p, day: uiRelativeDay(newDue, now, lang), amount: inr(cs.amountOverride ?? c.amount) });
    sub = tr(lang, "result.downgrade.sub", { brand: mer.brand, plan: s.idx.plan.get(cs.planOverride ?? "")?.name ?? "" });
  }
  else { title = tr(lang, "result.cancel", p); sub = tr(lang, "result.cancel.sub", p); }
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      {verified ? <span className="anim-pop flex h-14 w-14 items-center justify-center rounded-full bg-green-wash"><Check size={32} className="text-green" aria-hidden /></span> : <Clock size={40} className="text-amber" aria-hidden />}
      <h2 className="text-[20px] font-bold leading-[26px] text-navy">{title}</h2>
      {sub && <p className="text-[16px] text-slate">{sub}</p>}
      <ListenButton lang={lang} text={sub ? `${title} ${sub}` : title} />
      <div className="w-full py-2"><DebitTimeline startMs={ms(c.noticeAt)} endMs={ms(addMin(c.dueAt, -130))} nowMs={ms(now)} ended={choice !== "keep" && choice !== "downgrade"} variant="compact" /></div>
      <button onClick={close} className="h-12 w-full rounded-full btn-primary text-[16px] font-semibold text-white">{tr(lang, "button.ok")}</button>
    </div>
  );
}

// ---------- C5 ----------
function RetryScreen({ s, mandateId, lang, now, back, ask }: { s: Session; mandateId: string; lang: UiLang; now: string; back: () => void; ask: (cycleId: string) => void }) {
  const { send } = useHost();
  const m = s.idx.mandate.get(mandateId)!;
  const mer = s.idx.merchant.get(m.merchantId)!;
  const cycle = currentCycle(s, mandateId);
  const cs = s.state.cycle(cycle.id);
  const [busy, setBusy] = useState(false);
  const exec = [...s.state.executions.values()].filter((e) => e.cycleId === cycle.id).sort((a, b) => a.attempt - b.attempt);
  const tapped = !!cs.topupAt;
  const amount = inr(cycle.amount);
  const attempts = [1, 2, 3, 4].map((n) => {
    const e = exec.find((x) => x.attempt === n);
    if (e) return { n, when: `${uiDayMonth(e.at, lang)}, ${timeIST(e.at)}`, pill: e.result === "success" ? "pill.charged" : "pill.failed", kind: e.result === "success" ? "done" : "muted" };
    if (n === cs.attempts + 1 && cs.retryAt) return { n, when: `${uiRelativeDay(cs.retryAt, now, lang)}, ${tr(lang, "row.after", { time: "9:30 PM" })}`, pill: "pill.scheduled", kind: "neutral" };
    const day = addMin(cycle.dueAt, (n - 1) * 24 * 60);
    return { n, when: `${uiDayMonth(day, lang)}, ${tr(lang, "retry.night")}${n === 4 ? `, ${tr(lang, "retry.last")}` : ""}`, pill: null, kind: "" };
  });
  const why = peakWindow(new Date(cs.topupAt ?? now));
  const failed = exec.some((e) => e.result !== "success");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3">
        <button onClick={back} aria-label="Back"><ChevronLeft size={20} className="text-navy" /></button>
        <h1 className="text-[17px] font-semibold text-navy">{mer.brand} AutoPay</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-3 card p-3">
          <MerchantTile brand={mer.brand} tile={mer.tile} />
          <div className="flex-1"><div className="text-[16px] font-semibold">{mer.brand}</div><div className="text-[14px] text-slate">{tr(lang, "row.monthly_on", { n: 27 })}</div></div>
          <Amount paise={cycle.amount} lang={lang} />
        </div>
        {cs.status === "succeeded" ? (
          <div className="mt-3 rounded-[12px] bg-green-wash p-4 text-[17px] font-semibold text-green">{tr(lang, "success.title", { amount, brand: mer.brand })}</div>
        ) : failed ? (
          <div className="mt-3 card p-4">
            <h2 className="text-[20px] font-bold text-navy">{tr(lang, "failed.title", { amount })}</h2>
            <p className="mt-1 text-[15px] text-slate">{tr(lang, "failed.body")}</p>
            {tapped ? (
              <p className="mt-3 flex gap-2 rounded-[10px] bg-green-wash p-3 text-[14px] text-green"><Check size={18} className="shrink-0" aria-hidden />{tr(lang, "retry.done", { when: `${uiRelativeDay(cs.retryAt ?? now, now, lang).toLowerCase()} ${tr(lang, "row.after", { time: "9:30 PM" })}` })}</p>
            ) : cs.attempts >= 4 ? (
              <p className="mt-3 text-[14px] text-slate">{tr(lang, "failed.limit", { brand: mer.brand })}</p>
            ) : (
              <div className="mt-3 flex items-center gap-4">
                <button disabled={busy} onClick={async () => { setBusy(true); await send({ kind: "topup_confirmed", cycleId: cycle.id }); setBusy(false); }} className="h-12 flex-1 rounded-full btn-primary text-[16px] font-semibold text-white">{busy ? tr(lang, "button.working") : tr(lang, "failed.cta")}</button>
                <span className="text-[14px] text-slate">{tr(lang, "failed.remind")}</span>
              </div>
            )}
            <ol className="mt-4 divide-y divide-line">
              {attempts.map((a) => (
                <li key={a.n} className="flex items-center gap-3 py-2 text-[14px]">
                  <span className="w-5 font-bold text-navy">{a.n}</span><span className="flex-1">{a.when}</span>
                  {a.pill && <StatusPill kind={a.kind as "done"}>{tr(lang, a.pill as StringKey)}</StatusPill>}
                </li>
              ))}
            </ol>
            {(why || tapped) && (
              <p className="mt-3 flex gap-2 rounded-[10px] bg-canvas p-3 text-[14px] text-slate"><Clock size={18} className="shrink-0" aria-hidden />{tr(lang, why === "morning" ? "retry.why.morning" : "retry.why.evening")}</p>
            )}
          </div>
        ) : (
          <div className="mt-3 card p-4 text-[15px]">
            <p>{tr(lang, "collect.push", { day: uiRelativeDay(cycle.dueAt, now, lang), amount, brand: mer.brand })}</p>
          </div>
        )}
        {cs.status !== "succeeded" && cs.status !== "opted_out" && (
          <button onClick={() => ask(cycle.id)} className="mt-3 h-12 w-full rounded-[10px] border border-line-strong bg-surface text-[15px] font-semibold text-navy">{tr(lang, "retry.skip")}</button>
        )}
      </div>
    </div>
  );
}

// ---------- C9 ----------
function DetailScreen({ s, mandateId, lang, now, back, ask }: { s: Session; mandateId: string; lang: UiLang; now: string; back: () => void; ask: (cycleId: string) => void }) {
  const { send } = useHost();
  const m = s.idx.mandate.get(mandateId)!;
  const mer = s.idx.merchant.get(m.merchantId)!;
  const plan = s.idx.plan.get(m.planId)!;
  const cycle = currentCycle(s, mandateId);
  const hist = [...s.state.executions.values()].filter((e) => s.idx.cycle.get(e.cycleId)?.mandateId === mandateId || s.world.history.some((h) => h.id === e.id && h.mandateId === mandateId)).slice(-6);
  const rows: [StringKey, string][] = [
    ["detail.amount", inr(m.amountRule === "max" ? cycle.amount : plan.amount)],
    ["detail.when", `${tr(lang, "row.monthly")}, ${uiDayMonth(cycle.dueAt, lang)}`],
    ["detail.where", tr(lang, m.createdVia === "paytm" ? "detail.via_paytm" : "detail.via_other")],
    ["detail.validity", `${uiDayMonth(m.validityEnd, lang)} ${new Date(m.validityEnd).getUTCFullYear()}`],
    ...(m.trialStartedAt ? [["detail.trial", `${inr(plan.trialAmount ?? 0)}, ${uiDayMonth(m.trialStartedAt, lang)}`] as [StringKey, string]] : []),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3">
        <button onClick={back} aria-label="Back"><ChevronLeft size={20} className="text-navy" /></button>
        <h1 className="text-[17px] font-semibold text-navy">{mer.brand}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          <MerchantTile brand={mer.brand} tile={mer.tile} />
          <div className="flex-1"><div className="text-[17px] font-semibold">{mer.brand}</div><div className="text-[14px] text-slate">{mer.legalName}</div></div>
          <Amount paise={cycle.amount} size="l" lang={lang} />
        </div>
        <div className="mt-3 flex justify-end"><ListenButton lang={lang} text={`${mer.brand}. ${rows.map(([k, v]) => `${tr(lang, k)}: ${v}`).join(". ")}`} /></div>
        <dl className="mt-2 divide-y divide-line card">
          {rows.map(([k, v]) => <div key={k} className="flex justify-between px-4 py-3 text-[15px]"><dt className="text-slate">{tr(lang, k)}</dt><dd className="font-semibold">{v}</dd></div>)}
        </dl>
        {hist.length > 0 && (
          <>
            <h2 className="mt-4 text-[14px] font-semibold text-slate">{tr(lang, "detail.history")}</h2>
            <ul className="mt-1 divide-y divide-line card">
              {hist.map((h) => <li key={h.id} className="flex justify-between px-4 py-2.5 text-[14px]"><span>{uiDayMonth(h.at, lang)}</span><StatusPill kind={h.result === "success" ? "done" : "muted"}>{tr(lang, h.result === "success" ? "outcome.charged" : "outcome.failed")}</StatusPill></li>)}
            </ul>
          </>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {m.irrevocable ? (
            <div className="flex justify-between card px-4 py-3 text-[15px]"><span>{tr(lang, "detail.remind_when")}</span><span className="font-semibold">{tr(lang, "detail.remind_value")}</span></div>
          ) : s.state.mandateStatus.get(m.id) === "active" ? (
            <>
              <button onClick={() => ask(cycle.id)} className="press h-12 rounded-full border border-line-strong bg-surface text-[15px] font-semibold text-navy">{tr(lang, s.state.skipsUsed(m.id) >= maxSkipsAllowed() ? "choice.pause" : "choice.skip.month")} / {tr(lang, "choice.cancel")}</button>
              {s.state.alwaysKeep.has(m.id)
                ? <p className="flex items-center justify-center gap-1.5 rounded-full bg-green-wash py-3 text-[15px] font-semibold text-green"><Check size={18} aria-hidden />{tr(lang, "detail.always_keep")}</p>
                : <button onClick={() => send({ kind: "always_keep", mandateId: m.id })} className="btn-soft h-12 rounded-full text-[15px] font-semibold">{tr(lang, "detail.always_keep")}</button>}
            </>
          ) : (
            <div className="flex items-center justify-between card px-4 py-3 text-[15px]">
              <span className="font-semibold text-navy">{tr(lang, "result.cancel", { brand: mer.brand })}</span>
              <StatusPill kind="muted">{tr(lang, "pill.cancelled")}</StatusPill>
            </div>
          )}
        </div>
        {m.irrevocable && <p className="mt-3 flex gap-2 text-[14px] text-slate"><Lock size={16} className="mt-0.5" aria-hidden />{tr(lang, "row.irrevocable")}</p>}
      </div>
    </div>
  );
}

// ---------- C6, C7, C8 ----------
function CaseCards({ s, userId, lang, now, onFraud, onEscalate }: { s: Session; userId: string; lang: UiLang; now: string; onFraud: (code?: string, mandateId?: string) => void; onEscalate: () => void }) {
  const { send } = useHost();
  const refunds = [...s.state.refunds.values()].filter((r) => r.userId === userId);
  const cases = [...s.state.cases.values()].filter((c) => c.userId === userId);
  return (
    <>
      {cases.filter((c) => c.callback).map((c) => (
        c.callback!.doneAt ? (
          <p key={c.code + "cb"} className="mx-4 mt-4 flex items-center gap-2 card p-3 text-[14px]"><Phone size={16} className="text-navy" aria-hidden />{tr(lang, "callback.done", { name: "Priya", time: timeIST(c.callback!.doneAt) })}</p>
        ) : (
          <div key={c.code + "cb"} className="card mx-4 mt-4 p-4">
            <div className="flex gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy"><Phone size={18} className="text-white" aria-hidden /></span>
              <div>
                <p className="text-[16px] font-semibold">{tr(lang, "callback.title", { name: "Priya", by: timeIST(c.callback!.by) })}</p>
                <p className="text-[14px] text-slate">{tr(lang, "callback.number")}</p>
              </div>
            </div>
            <div className="mt-3 rounded-[10px] bg-cyan-wash p-3 text-center">
              <p className="text-[13px] text-slate">{tr(lang, "callback.code")}</p>
              <p className="tnum text-[26px] font-extrabold tracking-[0.18em] text-navy">{c.callback!.code}</p>
            </div>
            <p className="mt-3 flex gap-2 text-[14px]"><ShieldCheck size={18} className="shrink-0 text-green" aria-hidden />{tr(lang, "callback.never")}</p>
          </div>
        )
      ))}
      {refunds.map((r) => {
        const mer = s.idx.merchant.get(r.merchantId)!;
        const charge = s.state.executions.get(r.executionId);
        const cs = r.caseCode ? s.state.cases.get(r.caseCode) : undefined;
        if (r.status === "offered") {
          return (
            <div key={r.executionId} className="mx-4 mt-4 card p-4">
              <PakkaSeal />
              <p className="mt-2 text-[16px] font-semibold">{tr(lang, "refund.offer", { amount: inr(r.amount), brand: mer.brand, date: charge ? uiDayMonth(charge.at, lang) : "" })}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => send({ kind: "refund_answer", executionId: r.executionId, yes: true })} className="h-12 rounded-[10px] border border-line-strong text-[15px] font-semibold text-navy">{tr(lang, "refund.yes")}</button>
                <button onClick={() => send({ kind: "refund_answer", executionId: r.executionId, yes: false })} className="h-12 rounded-[10px] border border-line-strong text-[15px] font-semibold text-navy">{tr(lang, "refund.no")}</button>
              </div>
            </div>
          );
        }
        if (r.status === "declined_by_customer") return null;
        const decided = r.status === "sent" || r.status === "confirmed" || cs?.decision;
        const steps = [
          { k: tr(lang, "case.step1"), at: r.requestedAt, done: true },
          { k: tr(lang, "case.step2", { brand: mer.brand }), at: r.requestedAt, done: true },
          { k: cs?.status === "with_person" && !cs.decision ? tr(lang, "case.person") : tr(lang, "case.step3"), at: decided ? r.sentAt ?? cs?.decision?.at : undefined, done: !!decided, next: r.queuedUntil },
          { k: tr(lang, "case.step4"), at: r.confirmedAt, done: r.status === "confirmed" },
        ];
        const nowIdx = steps.findIndex((x) => !x.done);
        return (
          <div key={r.executionId} className="mx-4 mt-4 card p-4">
            <div className="flex items-center justify-between"><span className="text-[15px] font-semibold">{r.caseCode ? tr(lang, "case.title", { code: r.caseCode }) : mer.brand}</span><Amount paise={r.amount} lang={lang} /></div>
            <ol className="mt-3 flex flex-col">
              {steps.map((st, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full ${st.done ? "bg-navy" : i === nowIdx ? "border-[3px] border-cyan bg-white" : "border border-line-strong bg-white"}`}>{st.done && <Check size={14} className="text-white" aria-hidden />}</span>
                    {i < steps.length - 1 && <span className="h-6 w-0.5 bg-line" />}
                  </div>
                  <div className="pb-2 text-[14px]">
                    <div className="font-semibold">{st.k}</div>
                    <div className="text-slate">{st.at ? `${uiDayMonth(st.at, lang)}, ${timeIST(st.at)}` : i === nowIdx && st.next ? tr(lang, "case.next", { when: `${uiRelativeDay(st.next, now, lang)} ${timeIST(st.next)}` }) : ""}</div>
                  </div>
                </li>
              ))}
            </ol>
            {cs && <button onClick={onEscalate} className="mt-1 text-[14px] font-semibold text-navy underline">{tr(lang, "escalate.link")}</button>}
          </div>
        );
      })}
      {cases.filter((c) => c.type === "fraud").map((c) => (
        <button key={c.code} onClick={() => onFraud(c.code, c.mandateId)} className="mx-4 mt-4 flex w-[calc(100%-32px)] items-center justify-between card p-3 text-left text-[14px]">
          <span className="font-semibold">{tr(lang, "fraud.case", { code: c.code })}</span><StatusPill kind="fraud">{c.code}</StatusPill>
        </button>
      ))}
    </>
  );
}

function EscalationPath({ lang }: { lang: UiLang }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[20px] font-bold text-navy">{tr(lang, "escalate.link")}</h2>
      {(["escalate.bank", "escalate.npci", "escalate.rbi"] as StringKey[]).map((k) => <p key={k} className="rounded-[12px] border border-line p-3 text-[15px]">{tr(lang, k)}</p>)}
    </div>
  );
}

function FraudLaneSheet({ s, code, mandateId, lang, onCancel }: { s: Session; code?: string; mandateId?: string; userId: string; lang: UiLang; onCancel: (cycleId: string) => void }) {
  const cycle = mandateId ? (s.idx.cyclesByMandate.get(mandateId) ?? [])[0] : undefined;
  const active = mandateId ? s.state.mandateStatus.get(mandateId) === "active" : false;
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-[10px] bg-red-wash px-3 py-2 text-[16px] font-semibold text-red">{tr(lang, "fraud.title")}</p>
      <ol className="flex flex-col gap-2">
        {(["fraud.step1", "fraud.step2", "fraud.step3"] as StringKey[]).map((k, i) => (
          <li key={k} className="flex gap-3 rounded-[12px] border border-line p-3 text-[15px]"><span className="font-bold text-navy">{i + 1}</span><span>{tr(lang, k)}</span></li>
        ))}
      </ol>
      {cycle && active && <button onClick={() => onCancel(cycle.id)} className="h-12 rounded-full btn-primary text-[16px] font-semibold text-white">{tr(lang, "choice.cancel")}</button>}
      {code && <p className="text-[14px] text-slate">{tr(lang, "fraud.case", { code })}</p>}
    </div>
  );
}

// ---------- C10 ----------
function AskPakka({ s, userId, lang, onFraud, ask, onLang }: { s: Session; userId: string; lang: UiLang; onFraud: (code?: string, mandateId?: string) => void; ask: (cycleId: string) => void; onLang: (l: UiLang) => void }) {
  const { send } = useHost();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ intent: string; mandateId?: string; candidates: string[]; caseCode?: string } | null>(null);
  // The model's reply, shown only when the review loop approved it; otherwise the facts card below is the answer.
  const [reply, setReply] = useState<string | null>(null);
  const facts = useMemo(() => {
    if (!answer?.mandateId) return null;
    const m = s.idx.mandate.get(answer.mandateId)!;
    const mer = s.idx.merchant.get(m.merchantId)!;
    const plan = s.idx.plan.get(m.planId)!;
    const c = currentCycle(s, m.id);
    return { m, mer, plan, c };
  }, [answer, s]);
  const [mic, setMic] = useState<{ stop: () => void } | null>(null);
  const [heard, setHeard] = useState<{ lang: UiLang | null; english: string | null } | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    // The intake reads Hinglish and English. Anything else (typed or spoken) goes through Sarvam Translate first;
    // the customer keeps seeing their own words.
    const latin = /^[\x00-\x7F₹\s]*$/.test(text);
    const english = heard?.english ?? (latin ? null : await toEnglish(text, lang));
    const forIntake = (english ?? text).slice(0, 300);
    const live = await callModel<Omit<Intake, "modelVersion" | "review">>("intake", { text: forIntake }, { userId, lang: baseLang(lang) });
    // The classification is used when the model answered; the reply only when the review loop approved it.
    const intake: Intake | undefined = live?.output
      ? { ...live.output, modelVersion: live.promptVersion, review: live.review }
      : live?.review ? { ...intakeTemplate(forIntake), review: live.review } : undefined;
    const r = (await send({ kind: "question", userId, text: forIntake, intake })) as typeof answer;
    setBusy(false);
    setAnswer(r);
    // The reply is in English, Hindi or Hinglish; for other languages the facts card below is the answer.
    setReply(live?.output?.reply && live.review && live.review.status !== "template" && baseLang(lang) === lang ? live.output.reply : null);
    if (r?.intent === "never_approved") onFraud(r.caseCode, r.mandateId);
  };
  const toggleMic = async () => {
    setMicError(null);
    if (mic) { mic.stop(); setMic(null); setBusy(true); return; }
    const h = await startListening((res) => {
      setBusy(false);
      if ("error" in res) { setMicError(res.error); return; }
      setText(res.transcript);
      setHeard({ lang: res.language, english: res.english });
    });
    if ("error" in h) setMicError(h.error); else { setHeard(null); setMic(h); }
  };
  if (!open) return (
    <button onClick={() => setOpen(true)} className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full btn-primary px-5 py-2.5 text-[15px] font-semibold text-white shadow-[var(--shadow-float)]">{tr(lang, "ask.pill")}</button>
  );
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 max-h-[60%] overflow-y-auto border-t border-line bg-surface p-4 shadow-[var(--shadow-sheet)]">
      <div className="flex gap-2">
        <input autoFocus value={text} onChange={(e) => { setText(e.target.value); setHeard(null); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={tr(lang, "ask.placeholder")}
          className="h-12 min-w-0 flex-1 rounded-[8px] border border-line-strong px-3 text-[16px]" />
        <button aria-label={mic ? "Stop" : "Speak"} aria-pressed={!!mic} onClick={toggleMic} className={`flex h-12 w-12 items-center justify-center rounded-[8px] border ${mic ? "border-red bg-red-wash text-red" : "border-line-strong text-navy"}`}>{mic ? <Square size={18} /> : <Mic size={20} />}</button>
        <button aria-label="Close" onClick={() => { setOpen(false); setAnswer(null); setReply(null); }} className="text-slate"><X size={20} /></button>
      </div>
      {mic && <p className="mt-2 text-[14px] text-red" role="status">{tr(lang, "voice.listening")}</p>}
      {micError && <p className="mt-2 text-[14px] text-slate">{tr(lang, micError === "MIC_DENIED" ? "voice.micdenied" : "voice.error")}</p>}
      {heard?.lang && heard.lang !== lang && <button onClick={() => onLang(heard.lang!)} className="mt-2 text-[14px] font-semibold text-navy underline">{tr(heard.lang, "voice.switch", { lang: langInfo(heard.lang).native })}</button>}
      {busy && <p className="mt-2 text-[14px] text-slate">{tr(lang, "button.working")}</p>}
      {reply && answer?.intent !== "never_approved" && (
        <div className="mt-3 flex items-start gap-3 rounded-[12px] bg-sky-soft p-3">
          <p className="flex-1 text-[15px]">{reply}</p>
          <ListenButton lang={lang} text={reply} />
        </div>
      )}
      {facts && answer?.intent !== "never_approved" && (
        <div className="mt-3 rounded-[12px] border border-line p-3">
          <div className="flex items-center gap-3"><MerchantTile brand={facts.mer.brand} tile={facts.mer.tile} /><div className="flex-1 text-[16px] font-semibold">{facts.mer.brand}</div><Amount paise={facts.c.amount} lang={lang} /></div>
          <p className="mt-2 text-[15px]">{tr(lang, "ask.facts", { legal: facts.mer.legalName, brand: facts.mer.brand, plan: facts.plan.name, amount: inr(facts.c.amount), when: `${uiDayMonth(facts.c.dueAt, lang)}, ${timeIST(facts.c.dueAt)}` })}</p>
          {needsAnswer({ cs: s.state.cycle(facts.c.id) } as Row) && <button onClick={() => ask(facts.c.id)} className="mt-3 h-11 w-full rounded-full btn-primary text-[15px] font-semibold text-white">{tr(lang, "sheet.question")}</button>}
        </div>
      )}
      {answer && !answer.mandateId && (
        <div className="mt-3">
          <p className="text-[14px] text-slate">{tr(lang, "ask.nomatch")}</p>
          {answer.candidates.map((id) => { const mer = s.merchantOf(id); return <button key={id} onClick={() => setAnswer({ ...answer, mandateId: id })} className="mt-1 block w-full rounded-[10px] border border-line p-2 text-left text-[15px]">{mer.brand}</button>; })}
        </div>
      )}
    </div>
  );
}

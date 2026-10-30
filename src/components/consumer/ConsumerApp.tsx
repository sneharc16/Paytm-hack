"use client";
// Consumer app, /app (PRD 20.1): C1 list, C2 Doosri Haan sheet, C3 PIN pad, C4 result, C5 retry,
// C6 refund offer and tracker, C7 and C8 case and callback, C9 detail, C10 Pakka se poochho.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Info, Lock, Mic, Phone, ShieldCheck, Clock, Volume2, Pause, Check, Square, X } from "lucide-react";
import { type StringKey } from "@/copy/strings";
import { baseLang, isRegional, langInfo, type UiLang } from "@/copy/languages";
import { hasTable, tr, uiDayMonth, uiRelativeDay } from "@/copy/regional";
import { speakWithSarvam, startListening, toEnglish, useRegional } from "@/lib/regional-client";
import { addMin, istDay, ms, peakWindow } from "@/engine/clock";
import { hasNameGap } from "@/engine/namegap";
import type { Command } from "@/engine/commands";
import type { Choice, Persona } from "@/engine/types";
import { inr, timeIST } from "@/lib/format";
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
      {screen.name === "list" && <ListScreen s={session} userId={userId} lang={lang} now={now} setLang={setLang} top={listTop?.(openCustom)} open={(r) => setScreen(r.cycle.group === "collect" ? { name: "retry", mandateId: r.mandate.id } : { name: "detail", mandateId: r.mandate.id })} ask={(cycleId) => setSheet({ name: "decision", cycleId })} onFraud={(code, mandateId) => setSheet({ name: "fraud", code, mandateId })} onEscalate={() => setSheet({ name: "escalate" })} />}
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
function ListScreen({ s, userId, lang, now, setLang, open, ask, onFraud, onEscalate, top }: {
  s: Session; userId: string; lang: UiLang; now: string; setLang: (l: UiLang) => void; open: (r: Row) => void; ask: (cycleId: string) => void; top?: ReactNode;
  onFraud: (code?: string, mandateId?: string) => void; onEscalate: () => void;
}) {
  const rows = rowsFor(s, userId).sort((a, b) => ms(a.cycle.dueAt) - ms(b.cycle.dueAt));
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
        <h1 className="flex-1 text-[20px] font-bold text-navy">{tr(lang, "list.title")}</h1>
        <LangPicker lang={lang} onChange={setLang} />
      </header>
      <LangNotice lang={lang} />
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
      <AskPakka s={s} userId={userId} lang={lang} onFraud={onFraud} ask={ask} onLang={setLang} />
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
function choiceLabel(lang: UiLang, c: Choice, amountFor?: string) {
  return tr(lang, c === "keep" ? "choice.keep" : c === "skip" ? "choice.skip" : c === "pause" ? "choice.pause" : c === "cancel" ? "choice.cancel" : "choice.downgrade", { amount: amountFor ?? "" });
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
  const label = (c: Choice) => choiceLabel(lang, c, cheaper ? inr(cheaper.amount) : undefined);
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
    { id: "pause", desc: tr(lang, "choice.pause.desc"), pin: true },
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
      <p className="flex gap-2 text-[14px] text-slate"><Info size={18} className="shrink-0" aria-hidden />{tr(lang, dh ? "noanswer.dh" : "noanswer.default", p)}</p>
      <button disabled={!choice || busy} onClick={confirm} className={`h-12 rounded-[10px] text-[16px] font-semibold ${choice ? "btn-primary text-white" : "bg-line-strong text-slate"}`}>
        {busy ? tr(lang, "button.working") : choice ? label(choice) : tr(lang, "button.choose")}
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
  const brand = s.merchantOf(s.idx.cycle.get(cycleId)!.mandateId).brand;
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
      <p className="text-[14px] text-slate">{tr(lang, choice === "pause" ? "pin.what.pause" : "pin.what.cancel", { brand })}</p>
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
  const p = { day: uiRelativeDay(c.dueAt, now, lang), amount: inr(c.amount), brand: mer.brand, next: uiDayMonth(addMin(c.dueAt, 31 * 24 * 60), lang) };
  const verified = (choice === "skip" && cs.status === "skipped") || (choice === "keep" && cs.status === "confirmed") || ((choice === "pause" || choice === "cancel") && cs.status === "opted_out") || (choice === "downgrade" && !!cs.amountOverride);
  let title: string, sub = "";
  if (status === "held") title = tr(lang, "result.held");
  else if (status === "late") title = tr(lang, "result.late");
  else if (!verified) { title = tr(lang, "button.slow"); }
  else if (choice === "skip") { title = tr(lang, "result.skip", p); sub = tr(lang, "result.skip.sub", p); }
  else if (choice === "keep") { title = tr(lang, "result.keep", p); sub = tr(lang, "result.keep.sub", p); }
  else if (choice === "downgrade") {
    const newDue = cs.dueOverride ?? c.dueAt;
    title = tr(lang, "result.downgrade", { ...p, day: uiRelativeDay(newDue, now, lang), amount: inr(cs.amountOverride ?? c.amount) });
    sub = tr(lang, "result.downgrade.sub", { brand: mer.brand, plan: s.idx.plan.get(cs.planOverride ?? "")?.name ?? "" });
  }
  else if (choice === "pause") { title = tr(lang, "result.pause", p); sub = tr(lang, "result.pause.sub"); }
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
          ) : s.state.mandateStatus.get(m.id) === "active" && (
            <>
              <button onClick={() => ask(cycle.id)} className="press h-12 rounded-full border border-line-strong bg-surface text-[15px] font-semibold text-navy">{tr(lang, "choice.pause")} / {tr(lang, "choice.cancel")}</button>
              {s.state.alwaysKeep.has(m.id)
                ? <p className="flex items-center justify-center gap-1.5 rounded-full bg-green-wash py-3 text-[15px] font-semibold text-green"><Check size={18} aria-hidden />{tr(lang, "detail.always_keep")}</p>
                : <button onClick={() => send({ kind: "always_keep", mandateId: m.id })} className="btn-soft h-12 rounded-full text-[15px] font-semibold">{tr(lang, "detail.always_keep")}</button>}
            </>
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
    const live = await callModel<{ intent: "explain_charge" | "refund_request" | "cancel_help" | "never_approved" | "failed_charge" | "other"; merchant_text: string | null; amount_rupees: number | null; date_text: string | null; language: "hi" | "hinglish" | "en" }>("intake", { text: forIntake });
    const intake = live ? { ...live.output, modelVersion: live.promptVersion } : undefined;
    const r = (await send({ kind: "question", userId, text: forIntake, intake })) as typeof answer;
    setBusy(false);
    setAnswer(r);
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
        <button aria-label="Close" onClick={() => { setOpen(false); setAnswer(null); }} className="text-slate"><X size={20} /></button>
      </div>
      {mic && <p className="mt-2 text-[14px] text-red" role="status">{tr(lang, "voice.listening")}</p>}
      {micError && <p className="mt-2 text-[14px] text-slate">{tr(lang, micError === "MIC_DENIED" ? "voice.micdenied" : "voice.error")}</p>}
      {heard?.lang && heard.lang !== lang && <button onClick={() => onLang(heard.lang!)} className="mt-2 text-[14px] font-semibold text-navy underline">{tr(heard.lang, "voice.switch", { lang: langInfo(heard.lang).native })}</button>}
      {busy && <p className="mt-2 text-[14px] text-slate">{tr(lang, "button.working")}</p>}
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

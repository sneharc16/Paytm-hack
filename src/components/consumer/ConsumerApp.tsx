"use client";
// Consumer app, /app (PRD 20.1): C1 list, C2 Doosri Haan sheet, C3 PIN pad, C4 result, C5 retry,
// C6 refund offer and tracker, C7 and C8 case and callback, C9 detail, C10 Pakka se poochho.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Info, Lock, Mic, Phone, ShieldCheck, Clock, Check, X } from "lucide-react";
import { t, type StringKey } from "@/copy/strings";
import { addMin, ms, peakWindow } from "@/engine/clock";
import { intakeTemplate } from "@/engine/actions";
import { hasNameGap } from "@/engine/namegap";
import type { Intake } from "@/engine/resolve";
import type { Choice, Lang, Persona } from "@/engine/types";
import { dayMonth, inr, relativeDay, timeIST } from "@/lib/format";
import { sessionIdFromUrl, useSimNow, useSync } from "@/lib/sync/client";
import { callModel } from "@/lib/llm-client";
import { sheetVoiceText } from "@/lib/voice";
import { ListenButton } from "./ListenButton";
import { PERSONAS, isCollect, needsAnswer, pillFor, rowsFor, sectionOf, type Row } from "@/lib/views";
import { AIFooter, Amount, DebitTimeline, KillSwitchBanner, LangToggle, MerchantTile, PakkaSeal, StatusPill } from "@/components/shared";
import type { Session } from "@/engine/session";

type Screen = { name: "list" } | { name: "detail"; mandateId: string } | { name: "retry"; mandateId: string };
type Sheet = null | { name: "decision"; cycleId: string } | { name: "pin"; cycleId: string; choice: "pause" | "cancel" } | { name: "result"; cycleId: string; choice: Choice; status: string } | { name: "fraud"; code?: string; mandateId?: string } | { name: "escalate" };

function readParam(k: string) { return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(k); }

export default function ConsumerApp({ embedded = false }: { embedded?: boolean }) {
  const start = useSync((s) => s.start);
  const session = useSync((s) => s.session);
  useSync((s) => s.version);
  const now = useSimNow();
  const [persona, setPersona] = useState<Persona>("sunita");
  const [langOverride, setLangOverride] = useState<Partial<Record<Persona, Lang>>>({});
  const [screen, setScreen] = useState<Screen>({ name: "list" });
  const [sheet, setSheet] = useState<Sheet>(null);

  useEffect(() => {
    start(sessionIdFromUrl());
    const p = readParam("persona") as Persona | null;
    if (p && PERSONAS.some((x) => x.id === p)) setPersona(p);
    try { setLangOverride(JSON.parse(localStorage.getItem("pakka-lang") ?? "{}")); } catch { /* storage blocked */ }
  }, [start]);

  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(i); }, []);

  if (!session) return <div className="p-8 text-slate">Loading</div>;
  const userId = PERSONAS.find((p) => p.id === persona)!.userId;
  const lang: Lang = langOverride[persona] ?? session.idx.user.get(userId)!.lang;
  const setLang = (l: Lang) => {
    const next = { ...langOverride, [persona]: l };
    setLangOverride(next);
    try { localStorage.setItem("pakka-lang", JSON.stringify(next)); } catch { /* storage blocked */ }
  };
  const kill = session.state.killSwitch.global;

  const body = (
    <div className="relative flex h-full flex-col overflow-hidden bg-canvas">
      <div className="flex h-8 items-center justify-between bg-surface px-5 text-[13px] font-semibold text-ink">
        <span className="tnum">{timeIST(now).replace(/ (AM|PM)/, "")}</span><span className="text-slate">4G</span>
      </div>
      <KillSwitchBanner on={kill} lang={lang} />
      {screen.name === "list" && <ListScreen s={session} userId={userId} lang={lang} now={now} setLang={setLang} open={(r) => setScreen(r.cycle.group === "collect" ? { name: "retry", mandateId: r.mandate.id } : { name: "detail", mandateId: r.mandate.id })} ask={(cycleId) => setSheet({ name: "decision", cycleId })} onFraud={(code, mandateId) => setSheet({ name: "fraud", code, mandateId })} onEscalate={() => setSheet({ name: "escalate" })} />}
      {screen.name === "detail" && <DetailScreen s={session} mandateId={screen.mandateId} lang={lang} now={now} back={() => setScreen({ name: "list" })} ask={(cycleId) => setSheet({ name: "decision", cycleId })} />}
      {screen.name === "retry" && <RetryScreen s={session} mandateId={screen.mandateId} lang={lang} now={now} back={() => setScreen({ name: "list" })} ask={(cycleId) => setSheet({ name: "decision", cycleId })} />}
      {sheet && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end">
          <button aria-label="Close" className="anim-backdrop absolute inset-0 bg-[rgba(10,25,55,.42)]" onClick={() => setSheet(null)} />
          <div role="dialog" aria-modal className="anim-sheet relative max-h-[92%] overflow-y-auto rounded-t-[28px] bg-surface px-4 pb-5 pt-2 shadow-[var(--shadow-sheet)]" onKeyDown={(e) => e.key === "Escape" && setSheet(null)}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
            {sheet.name === "decision" && <DecisionSheet s={session} cycleId={sheet.cycleId} lang={lang} now={now} onPin={(choice) => setSheet({ name: "pin", cycleId: sheet.cycleId, choice })} onDone={(choice, status) => setSheet({ name: "result", cycleId: sheet.cycleId, choice, status })} />}
            {sheet.name === "pin" && <PinPad s={session} userId={userId} cycleId={sheet.cycleId} choice={sheet.choice} lang={lang} onDone={(status) => setSheet({ name: "result", cycleId: sheet.cycleId, choice: sheet.choice, status })} />}
            {sheet.name === "result" && <ResultState s={session} cycleId={sheet.cycleId} choice={sheet.choice} status={sheet.status} lang={lang} now={now} close={() => setSheet(null)} />}
            {sheet.name === "fraud" && <FraudLaneSheet s={session} code={sheet.code} mandateId={sheet.mandateId} userId={userId} lang={lang} onCancel={(cycleId) => setSheet({ name: "pin", cycleId, choice: "cancel" })} />}
            {sheet.name === "escalate" && <EscalationPath lang={lang} />}
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return <div className="h-full">{body}</div>;
  return (
    <main className="flex min-h-screen flex-col items-center gap-3 py-4 sm:py-6">
      <div className="hidden items-center gap-2 sm:flex">
        <span className="text-[13px] text-slate">{t("en", "persona.switch")}</span>
        {PERSONAS.map((p) => (
          <button key={p.id} onClick={() => { setPersona(p.id); setScreen({ name: "list" }); setSheet(null); }}
            className={`rounded-full px-3 py-1 text-[13px] font-semibold ${persona === p.id ? "btn-primary text-white" : "border border-line-strong text-navy"}`}>{p.label}</button>
        ))}
      </div>
      <div className="h-[100dvh] w-full overflow-hidden sm:h-[844px] sm:w-[390px] sm:rounded-[36px] sm:border-[10px] sm:border-ink">{body}</div>
      <div className="flex gap-2 sm:hidden">
        {PERSONAS.map((p) => <button key={p.id} onClick={() => { setPersona(p.id); setScreen({ name: "list" }); setSheet(null); }} className="text-[12px] text-slate underline">{p.label}</button>)}
      </div>
    </main>
  );
}

// ---------- C1 ----------
function ListScreen({ s, userId, lang, now, setLang, open, ask, onFraud, onEscalate }: {
  s: Session; userId: string; lang: Lang; now: string; setLang: (l: Lang) => void; open: (r: Row) => void; ask: (cycleId: string) => void;
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 bg-surface px-4 py-3 shadow-[0_1px_0_var(--line)]">
        <ChevronLeft size={20} strokeWidth={1.8} className="text-blue" aria-hidden />
        <h1 className="flex-1 text-[20px] font-bold text-navy">{t(lang, "list.title")}</h1>
        <LangToggle lang={lang} onChange={setLang} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        <CaseCards s={s} userId={userId} lang={lang} now={now} onFraud={onFraud} onEscalate={onEscalate} />
        {first && (
          <div className="mx-4 mt-4 rounded-[20px] bg-gradient-to-br from-sky to-blue px-4 py-4 text-white shadow-[0_10px_24px_rgba(11,114,231,0.30)]">
            <PakkaSeal onNavy />
            <p className="mt-2 text-[17px] font-semibold leading-6">
              {asks.length ? t(lang, "nudge.card.title", { n: soonCount })
                : first.cs.status === "failed_business" ? t(lang, "failed.title", { amount: inr(first.cycle.amount) })
                : first.cs.status === "retry_scheduled" && first.cs.retryAt ? t(lang, "retry.done", { when: `${relativeDay(first.cs.retryAt, now, lang).toLowerCase()} ${t(lang, "row.after", { time: "9:30 PM" })}` })
                : t(lang, "nudge.card.collect", { brand: first.merchant.brand, amount: inr(first.cycle.amount), day: relativeDay(first.cycle.dueAt, now, lang) })}
            </p>
            {asks.length > 0 && <p className="mt-1 text-[14px] text-white/80">{t(lang, "nudge.card.sub", { brand: asks[0].merchant.brand, amount: inr(asks[0].cycle.amount) })}</p>}
            <button onClick={() => (asks.length ? ask(asks[0].cycle.id) : open(first))} className="press mt-3 h-[38px] rounded-full bg-white px-5 text-[15px] font-semibold text-blue">{t(lang, "nudge.card.cta")}</button>
          </div>
        )}
        {rows.length === 0 && <p className="p-6 text-slate">{t(lang, "list.empty")}</p>}
        {groups.map((g) => g.rows.length > 0 && (
          <section key={g.key}>
            <h2 className="px-5 pb-2 pt-4 text-[14px] font-semibold text-slate">
              {g.key === "soon" ? soonLabel(g.rows[0].cycle.dueAt, now, lang) : t(lang, g.key)}
            </h2>
            <div className="card mx-4 overflow-hidden">
              {g.rows.map((r) => <MandateRow key={r.mandate.id} r={r} lang={lang} now={now} onClick={() => (needsAnswer(r) ? ask(r.cycle.id) : open(r))} />)}
            </div>
          </section>
        ))}
        <div className="flex items-start gap-2 px-4 py-4"><Info size={16} className="mt-0.5 text-mist" aria-hidden /><AIFooter lang={lang} align="left" list /></div>
      </div>
      <AskPakka s={s} userId={userId} lang={lang} onFraud={onFraud} ask={ask} />
    </div>
  );
}

/** "Kal, 27 Oct", or just "27 Oct" when the day is already a date (past or far off). */
function soonLabel(dueAt: string, now: string, lang: Lang) {
  const rel = relativeDay(dueAt, now, lang);
  const date = dayMonth(dueAt, lang);
  return rel === date ? date : `${rel}, ${date}`;
}

function MandateRow({ r, lang, now, onClick }: { r: Row; lang: Lang; now: string; onClick: () => void }) {
  const pill = pillFor(r);
  const soon = sectionOf(r, now) === "soon";
  const sub = r.mandate.irrevocable ? t(lang, "row.irrevocable") : r.mandate.visibleViaInterop ? t(lang, "row.interop") : soon ? t(lang, "row.after", { time: "9:30 PM" }) : t(lang, "row.monthly");
  return (
    <button onClick={onClick} className="flex min-h-12 w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-canvas active:bg-sky-soft/60">
      <MerchantTile brand={r.merchant.brand} tile={r.merchant.tile} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold">{r.merchant.brand}{r.merchant.category === "loan" ? " EMI" : ""}</div>
        <div className="flex items-center gap-1 text-[14px] text-slate">{r.mandate.irrevocable && <Lock size={16} strokeWidth={1.8} aria-hidden />}<span className="truncate">{sub}</span></div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Amount paise={r.cs.amountOverride ?? r.cycle.amount} lang={lang} />
        {pill ? <StatusPill kind={pill.kind}>{t(lang, pill.key as StringKey)}</StatusPill> : <span className="text-[14px] text-slate">{dayMonth(r.cycle.dueAt, lang)}</span>}
      </div>
    </button>
  );
}

// ---------- C2 ----------
function choiceLabel(lang: Lang, c: Choice, amountFor?: string) {
  return t(lang, c === "keep" ? "choice.keep" : c === "skip" ? "choice.skip" : c === "pause" ? "choice.pause" : c === "cancel" ? "choice.cancel" : "choice.downgrade", { amount: amountFor ?? "" });
}

function DecisionSheet({ s, cycleId, lang, now, onPin, onDone }: { s: Session; cycleId: string; lang: Lang; now: string; onPin: (c: "pause" | "cancel") => void; onDone: (c: Choice, status: string) => void }) {
  const send = useSync((x) => x.send);
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
  const day = relativeDay(cs.dueOverride ?? c.dueAt, now, lang);
  const amount = inr(cs.amountOverride ?? c.amount);
  const p = { day, amount, brand: mer.brand, trialDate: m.trialStartedAt ? dayMonth(m.trialStartedAt, lang) : "", trialAmount: plan.trialAmount ? inr(plan.trialAmount) : "" };
  const lede = c.firstAfterTrial && m.trialStartedAt
    ? t(lang, m.usageConsent && usage && !usage.openedSinceTrial ? "sheet.lede.trial_unused" : "sheet.lede.trial", p)
    : t(lang, "sheet.lede.first");
  const dh = cs.askRule === "DH_ASK_V1";
  const options: { id: Choice; desc: string; offer?: boolean; pin?: boolean }[] = [
    { id: "keep", desc: t(lang, "choice.keep.desc", p) },
    ...(settings.offerSkip ? [{ id: "skip" as Choice, desc: t(lang, "choice.skip.desc"), offer: true }] : []),
    ...(cheaper ? [{ id: "downgrade" as Choice, desc: t(lang, "choice.downgrade.desc", { amount: inr(cheaper.amount) }), offer: true }] : []),
    { id: "pause", desc: t(lang, "choice.pause.desc"), pin: true },
    { id: "cancel", desc: t(lang, "choice.cancel.desc", p), pin: true },
  ];
  // Spoken in the customer's language: the reminder that was sent (recorded for the story), else the sheet's own words.
  const voiceText = sheetVoiceText(s, cycleId, lang) ?? `${t(lang, "sheet.title", p)}. ${lede}${hasNameGap(mer.brand, mer.legalName) && mer.brandVerified ? ` ${t(lang, "namegap", { legal: mer.legalName, brand: mer.brand })}` : ""}`;
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
        <ListenButton key={`${lang}|${voiceText}`} text={voiceText} lang={lang} />
      </div>
      <h2 className="text-[23px] font-bold leading-7 text-navy">{t(lang, "sheet.title", p)}</h2>
      <p className="text-[16px] text-slate">{lede}</p>
      <DebitTimeline startMs={ms(cs.noticeAt ?? c.noticeAt)} endMs={ms(addMin(c.dueAt, -130))} nowMs={ms(now)}
        left={[`${relativeDay(cs.noticeAt ?? c.noticeAt, now, lang)} ${timeIST(cs.noticeAt ?? c.noticeAt)}`, t(lang, "timeline.now")]}
        right={[`${day} ${t(lang, "timeline.after", { time: "9:30 PM" })}`, t(lang, "timeline.end", { amount })]}
        ariaLabel={`${timeIST(cs.noticeAt ?? c.noticeAt)} to ${day} 9:30 PM`} />
      {hasNameGap(mer.brand, mer.legalName) && mer.brandVerified && (
        <div className="flex gap-2 rounded-[10px] bg-canvas px-3 py-2.5 text-[14px]">
          <ShieldCheck size={20} strokeWidth={1.8} className="shrink-0 text-green" aria-hidden />
          <span>{t(lang, "namegap", { legal: mer.legalName, brand: mer.brand }).split(mer.legalName).flatMap((x, i, a) => (i < a.length - 1 ? [x, <b key={i}>{mer.legalName}</b>] : [x]))}</span>
        </div>
      )}
      {cs.decision && <p className="text-[14px] text-slate">{t(lang, "sheet.changed", { choice: label(cs.decision) })}</p>}
      <h3 className="text-[17px] font-semibold">{t(lang, "sheet.question")}</h3>
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
                    {o.offer && <span className="rounded-full bg-offer-wash px-2 py-px text-[12.5px] font-semibold text-offer">{t(lang, "tag.offer", { brand: mer.brand })}</span>}
                    {o.pin && <><Lock size={16} strokeWidth={1.8} aria-hidden />{t(lang, "tag.pin")}</>}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <p className="flex gap-2 text-[14px] text-slate"><Info size={18} className="shrink-0" aria-hidden />{t(lang, dh ? "noanswer.dh" : "noanswer.default", p)}</p>
      <button disabled={!choice || busy} onClick={confirm} className={`h-12 rounded-[10px] text-[16px] font-semibold ${choice ? "btn-primary text-white" : "bg-line-strong text-slate"}`}>
        {busy ? t(lang, "button.working") : choice ? label(choice) : t(lang, "button.choose")}
      </button>
      <AIFooter lang={lang} />
    </div>
  );
}

// ---------- C3 ----------
function PinPad({ s, userId, cycleId, choice, lang, onDone }: { s: Session; userId: string; cycleId: string; choice: "pause" | "cancel"; lang: Lang; onDone: (status: string) => void }) {
  const send = useSync((x) => x.send);
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
      <p className="rounded-full bg-amber-wash px-3 py-0.5 text-[13px] font-semibold text-amber">{t(lang, "pin.demo")}</p>
      <h2 className="text-[20px] font-bold text-navy">{t(lang, "pin.title")}</h2>
      <p className="text-[14px] text-slate">{t(lang, choice === "pause" ? "pin.what.pause" : "pin.what.cancel", { brand })}</p>
      <div className="flex gap-3" aria-label={`${digits.length} digits entered`}>
        {Array.from({ length: 6 }, (_, i) => <span key={i} className={`h-3 w-3 rounded-full ${i < digits.length ? "bg-navy" : "border border-line-strong"}`} />)}
      </div>
      {err && <p className="text-[14px] text-red">{t(lang, "pin.wrong")}</p>}
      <div className="grid w-full grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k) => k === "" ? <span key="blank" /> : (
          <button key={k} onClick={() => { setErr(false); setDigits((d) => (k === "del" ? d.slice(0, -1) : d.length < 6 ? d + k : d)); }}
            className="h-12 rounded-[10px] border border-line text-[20px] font-semibold text-ink" aria-label={k === "del" ? "Delete" : k}>{k === "del" ? <X size={20} className="mx-auto" /> : k}</button>
        ))}
      </div>
      <button disabled={busy || !(digits.length === 4 || digits.length === 6)} onClick={submit} className="h-12 w-full rounded-full btn-primary text-[16px] font-semibold text-white disabled:bg-line-strong disabled:text-slate">
        {busy ? t(lang, "button.working") : t(lang, "button.ok")}
      </button>
    </div>
  );
}

// ---------- C4 ----------
function ResultState({ s, cycleId, choice, status, lang, now, close }: { s: Session; cycleId: string; choice: Choice; status: string; lang: Lang; now: string; close: () => void }) {
  const c = s.idx.cycle.get(cycleId)!;
  const cs = s.state.cycle(cycleId);
  const mer = s.merchantOf(c.mandateId);
  const p = { day: relativeDay(c.dueAt, now, lang), amount: inr(c.amount), brand: mer.brand, next: dayMonth(addMin(c.dueAt, 31 * 24 * 60), lang) };
  const verified = (choice === "skip" && cs.status === "skipped") || (choice === "keep" && cs.status === "confirmed") || ((choice === "pause" || choice === "cancel") && cs.status === "opted_out") || (choice === "downgrade" && !!cs.amountOverride);
  let title: string, sub = "";
  if (status === "held") title = t(lang, "result.held");
  else if (status === "late") title = t(lang, "result.late");
  else if (!verified) { title = t(lang, "button.slow"); }
  else if (choice === "skip") { title = t(lang, "result.skip", p); sub = t(lang, "result.skip.sub", p); }
  else if (choice === "keep") { title = t(lang, "result.keep", p); sub = t(lang, "result.keep.sub", p); }
  else if (choice === "downgrade") {
    const newDue = cs.dueOverride ?? c.dueAt;
    title = t(lang, "result.downgrade", { ...p, day: relativeDay(newDue, now, lang), amount: inr(cs.amountOverride ?? c.amount) });
    sub = t(lang, "result.downgrade.sub", { brand: mer.brand, plan: s.idx.plan.get(cs.planOverride ?? "")?.name ?? "" });
  }
  else if (choice === "pause") { title = t(lang, "result.pause", p); sub = t(lang, "result.pause.sub"); }
  else { title = t(lang, "result.cancel", p); sub = t(lang, "result.cancel.sub", p); }
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      {verified ? <span className="anim-pop flex h-14 w-14 items-center justify-center rounded-full bg-green-wash"><Check size={32} className="text-green" aria-hidden /></span> : <Clock size={40} className="text-amber" aria-hidden />}
      <h2 className="text-[20px] font-bold leading-[26px] text-navy">{title}</h2>
      {sub && <p className="text-[16px] text-slate">{sub}</p>}
      <div className="w-full py-2"><DebitTimeline startMs={ms(c.noticeAt)} endMs={ms(addMin(c.dueAt, -130))} nowMs={ms(now)} ended={choice !== "keep" && choice !== "downgrade"} variant="compact" /></div>
      <button onClick={close} className="h-12 w-full rounded-full btn-primary text-[16px] font-semibold text-white">{t(lang, "button.ok")}</button>
    </div>
  );
}

// ---------- C5 ----------
function RetryScreen({ s, mandateId, lang, now, back, ask }: { s: Session; mandateId: string; lang: Lang; now: string; back: () => void; ask: (cycleId: string) => void }) {
  const send = useSync((x) => x.send);
  const m = s.idx.mandate.get(mandateId)!;
  const mer = s.idx.merchant.get(m.merchantId)!;
  const cycle = (s.idx.cyclesByMandate.get(mandateId) ?? []).reduce((a, b) => (b.seq > a.seq ? b : a));
  const cs = s.state.cycle(cycle.id);
  const [busy, setBusy] = useState(false);
  const exec = [...s.state.executions.values()].filter((e) => e.cycleId === cycle.id).sort((a, b) => a.attempt - b.attempt);
  const tapped = !!cs.topupAt;
  const amount = inr(cycle.amount);
  const attempts = [1, 2, 3, 4].map((n) => {
    const e = exec.find((x) => x.attempt === n);
    if (e) return { n, when: `${dayMonth(e.at, lang)}, ${timeIST(e.at)}`, pill: e.result === "success" ? "pill.charged" : "pill.failed", kind: e.result === "success" ? "done" : "muted" };
    if (n === cs.attempts + 1 && cs.retryAt) return { n, when: `${relativeDay(cs.retryAt, now, lang)}, ${t(lang, "row.after", { time: "9:30 PM" })}`, pill: "pill.scheduled", kind: "neutral" };
    const day = addMin(cycle.dueAt, (n - 1) * 24 * 60);
    return { n, when: `${dayMonth(day, lang)}, ${t(lang, "retry.night")}${n === 4 ? `, ${t(lang, "retry.last")}` : ""}`, pill: null, kind: "" };
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
          <div className="flex-1"><div className="text-[16px] font-semibold">{mer.brand}</div><div className="text-[14px] text-slate">{t(lang, "row.monthly_on", { n: 27 })}</div></div>
          <Amount paise={cycle.amount} lang={lang} />
        </div>
        {cs.status === "succeeded" ? (
          <div className="mt-3 rounded-[12px] bg-green-wash p-4 text-[17px] font-semibold text-green">{t(lang, "success.title", { amount, brand: mer.brand })}</div>
        ) : failed ? (
          <div className="mt-3 card p-4">
            <h2 className="text-[20px] font-bold text-navy">{t(lang, "failed.title", { amount })}</h2>
            <p className="mt-1 text-[15px] text-slate">{t(lang, "failed.body")}</p>
            {tapped ? (
              <p className="mt-3 flex gap-2 rounded-[10px] bg-green-wash p-3 text-[14px] text-green"><Check size={18} className="shrink-0" aria-hidden />{t(lang, "retry.done", { when: `${relativeDay(cs.retryAt ?? now, now, lang).toLowerCase()} ${t(lang, "row.after", { time: "9:30 PM" })}` })}</p>
            ) : cs.attempts >= 4 ? (
              <p className="mt-3 text-[14px] text-slate">{t(lang, "failed.limit", { brand: mer.brand })}</p>
            ) : (
              <div className="mt-3 flex items-center gap-4">
                <button disabled={busy} onClick={async () => { setBusy(true); await send({ kind: "topup_confirmed", cycleId: cycle.id }); setBusy(false); }} className="h-12 flex-1 rounded-full btn-primary text-[16px] font-semibold text-white">{busy ? t(lang, "button.working") : t(lang, "failed.cta")}</button>
                <span className="text-[14px] text-slate">{t(lang, "failed.remind")}</span>
              </div>
            )}
            <ol className="mt-4 divide-y divide-line">
              {attempts.map((a) => (
                <li key={a.n} className="flex items-center gap-3 py-2 text-[14px]">
                  <span className="w-5 font-bold text-navy">{a.n}</span><span className="flex-1">{a.when}</span>
                  {a.pill && <StatusPill kind={a.kind as "done"}>{t(lang, a.pill as StringKey)}</StatusPill>}
                </li>
              ))}
            </ol>
            {(why || tapped) && (
              <p className="mt-3 flex gap-2 rounded-[10px] bg-canvas p-3 text-[14px] text-slate"><Clock size={18} className="shrink-0" aria-hidden />{t(lang, why === "morning" ? "retry.why.morning" : "retry.why.evening")}</p>
            )}
          </div>
        ) : (
          <div className="mt-3 card p-4 text-[15px]">
            <p>{t(lang, "collect.push", { day: relativeDay(cycle.dueAt, now, lang), amount, brand: mer.brand })}</p>
          </div>
        )}
        {cs.status !== "succeeded" && cs.status !== "opted_out" && (
          <button onClick={() => ask(cycle.id)} className="mt-3 h-12 w-full rounded-[10px] border border-line-strong bg-surface text-[15px] font-semibold text-navy">{t(lang, "retry.skip")}</button>
        )}
      </div>
    </div>
  );
}

// ---------- C9 ----------
function DetailScreen({ s, mandateId, lang, now, back, ask }: { s: Session; mandateId: string; lang: Lang; now: string; back: () => void; ask: (cycleId: string) => void }) {
  const send = useSync((x) => x.send);
  const m = s.idx.mandate.get(mandateId)!;
  const mer = s.idx.merchant.get(m.merchantId)!;
  const plan = s.idx.plan.get(m.planId)!;
  const cycles = s.idx.cyclesByMandate.get(mandateId) ?? [];
  const cycle = cycles.reduce((a, b) => (b.seq > a.seq ? b : a));
  const hist = [...s.state.executions.values()].filter((e) => s.idx.cycle.get(e.cycleId)?.mandateId === mandateId || s.world.history.some((h) => h.id === e.id && h.mandateId === mandateId)).slice(-6);
  const rows: [StringKey, string][] = [
    ["detail.amount", inr(m.amountRule === "max" ? cycle.amount : plan.amount)],
    ["detail.when", `${t(lang, "row.monthly")}, ${dayMonth(cycle.dueAt, lang)}`],
    ["detail.where", t(lang, m.createdVia === "paytm" ? "detail.via_paytm" : "detail.via_other")],
    ["detail.validity", dayMonth(m.validityEnd, lang) + " 2030"],
    ...(m.trialStartedAt ? [["detail.trial", `${inr(plan.trialAmount ?? 0)}, ${dayMonth(m.trialStartedAt, lang)}`] as [StringKey, string]] : []),
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
        <dl className="mt-4 divide-y divide-line card">
          {rows.map(([k, v]) => <div key={k} className="flex justify-between px-4 py-3 text-[15px]"><dt className="text-slate">{t(lang, k)}</dt><dd className="font-semibold">{v}</dd></div>)}
        </dl>
        {hist.length > 0 && (
          <>
            <h2 className="mt-4 text-[14px] font-semibold text-slate">{t(lang, "detail.history")}</h2>
            <ul className="mt-1 divide-y divide-line card">
              {hist.map((h) => <li key={h.id} className="flex justify-between px-4 py-2.5 text-[14px]"><span>{dayMonth(h.at, lang)}</span><StatusPill kind={h.result === "success" ? "done" : "muted"}>{t(lang, h.result === "success" ? "outcome.charged" : "outcome.failed")}</StatusPill></li>)}
            </ul>
          </>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {m.irrevocable ? (
            <div className="flex justify-between card px-4 py-3 text-[15px]"><span>{t(lang, "detail.remind_when")}</span><span className="font-semibold">{t(lang, "detail.remind_value")}</span></div>
          ) : s.state.mandateStatus.get(m.id) === "active" && (
            <>
              <button onClick={() => ask(cycle.id)} className="press h-12 rounded-full border border-line-strong bg-surface text-[15px] font-semibold text-navy">{t(lang, "choice.pause")} / {t(lang, "choice.cancel")}</button>
              {s.state.alwaysKeep.has(m.id)
                ? <p className="flex items-center justify-center gap-1.5 rounded-full bg-green-wash py-3 text-[15px] font-semibold text-green"><Check size={18} aria-hidden />{t(lang, "detail.always_keep")}</p>
                : <button onClick={() => send({ kind: "always_keep", mandateId: m.id })} className="btn-soft h-12 rounded-full text-[15px] font-semibold">{t(lang, "detail.always_keep")}</button>}
            </>
          )}
        </div>
        {m.irrevocable && <p className="mt-3 flex gap-2 text-[14px] text-slate"><Lock size={16} className="mt-0.5" aria-hidden />{t(lang, "row.irrevocable")}</p>}
      </div>
    </div>
  );
}

// ---------- C6, C7, C8 ----------
function CaseCards({ s, userId, lang, now, onFraud, onEscalate }: { s: Session; userId: string; lang: Lang; now: string; onFraud: (code?: string, mandateId?: string) => void; onEscalate: () => void }) {
  const send = useSync((x) => x.send);
  const refunds = [...s.state.refunds.values()].filter((r) => r.userId === userId);
  const cases = [...s.state.cases.values()].filter((c) => c.userId === userId);
  return (
    <>
      {cases.filter((c) => c.callback).map((c) => (
        c.callback!.doneAt ? (
          <p key={c.code + "cb"} className="mx-4 mt-4 flex items-center gap-2 card p-3 text-[14px]"><Phone size={16} className="text-navy" aria-hidden />{t(lang, "callback.done", { name: "Priya", time: timeIST(c.callback!.doneAt) })}</p>
        ) : (
          <div key={c.code + "cb"} className="card mx-4 mt-4 p-4">
            <div className="flex gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy"><Phone size={18} className="text-white" aria-hidden /></span>
              <div>
                <p className="text-[16px] font-semibold">{t(lang, "callback.title", { name: "Priya", by: timeIST(c.callback!.by) })}</p>
                <p className="text-[14px] text-slate">{t(lang, "callback.number")}</p>
              </div>
            </div>
            <div className="mt-3 rounded-[10px] bg-cyan-wash p-3 text-center">
              <p className="text-[13px] text-slate">{t(lang, "callback.code")}</p>
              <p className="tnum text-[26px] font-extrabold tracking-[0.18em] text-navy">{c.callback!.code}</p>
            </div>
            <p className="mt-3 flex gap-2 text-[14px]"><ShieldCheck size={18} className="shrink-0 text-green" aria-hidden />{t(lang, "callback.never")}</p>
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
              <p className="mt-2 text-[16px] font-semibold">{t(lang, "refund.offer", { amount: inr(r.amount), brand: mer.brand, date: charge ? dayMonth(charge.at, lang) : "" })}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => send({ kind: "refund_answer", executionId: r.executionId, yes: true })} className="h-12 rounded-[10px] border border-line-strong text-[15px] font-semibold text-navy">{t(lang, "refund.yes")}</button>
                <button onClick={() => send({ kind: "refund_answer", executionId: r.executionId, yes: false })} className="h-12 rounded-[10px] border border-line-strong text-[15px] font-semibold text-navy">{t(lang, "refund.no")}</button>
              </div>
            </div>
          );
        }
        if (r.status === "declined_by_customer") return null;
        const decided = r.status === "sent" || r.status === "confirmed" || cs?.decision;
        const steps = [
          { k: t(lang, "case.step1"), at: r.requestedAt, done: true },
          { k: t(lang, "case.step2", { brand: mer.brand }), at: r.requestedAt, done: true },
          { k: cs?.status === "with_person" && !cs.decision ? t(lang, "case.person") : t(lang, "case.step3"), at: decided ? r.sentAt ?? cs?.decision?.at : undefined, done: !!decided, next: r.queuedUntil },
          { k: t(lang, "case.step4"), at: r.confirmedAt, done: r.status === "confirmed" },
        ];
        const nowIdx = steps.findIndex((x) => !x.done);
        return (
          <div key={r.executionId} className="mx-4 mt-4 card p-4">
            <div className="flex items-center justify-between"><span className="text-[15px] font-semibold">{r.caseCode ? t(lang, "case.title", { code: r.caseCode }) : mer.brand}</span><Amount paise={r.amount} lang={lang} /></div>
            <ol className="mt-3 flex flex-col">
              {steps.map((st, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full ${st.done ? "bg-navy" : i === nowIdx ? "border-[3px] border-cyan bg-white" : "border border-line-strong bg-white"}`}>{st.done && <Check size={14} className="text-white" aria-hidden />}</span>
                    {i < steps.length - 1 && <span className="h-6 w-0.5 bg-line" />}
                  </div>
                  <div className="pb-2 text-[14px]">
                    <div className="font-semibold">{st.k}</div>
                    <div className="text-slate">{st.at ? `${dayMonth(st.at, lang)}, ${timeIST(st.at)}` : i === nowIdx && st.next ? t(lang, "case.next", { when: `${relativeDay(st.next, now, lang)} ${timeIST(st.next)}` }) : ""}</div>
                  </div>
                </li>
              ))}
            </ol>
            {cs && <button onClick={onEscalate} className="mt-1 text-[14px] font-semibold text-navy underline">{t(lang, "escalate.link")}</button>}
          </div>
        );
      })}
      {cases.filter((c) => c.type === "fraud").map((c) => (
        <button key={c.code} onClick={() => onFraud(c.code, c.mandateId)} className="mx-4 mt-4 flex w-[calc(100%-32px)] items-center justify-between card p-3 text-left text-[14px]">
          <span className="font-semibold">{t(lang, "fraud.case", { code: c.code })}</span><StatusPill kind="fraud">{c.code}</StatusPill>
        </button>
      ))}
    </>
  );
}

function EscalationPath({ lang }: { lang: Lang }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[20px] font-bold text-navy">{t(lang, "escalate.link")}</h2>
      {(["escalate.bank", "escalate.npci", "escalate.rbi"] as StringKey[]).map((k) => <p key={k} className="rounded-[12px] border border-line p-3 text-[15px]">{t(lang, k)}</p>)}
    </div>
  );
}

function FraudLaneSheet({ s, code, mandateId, lang, onCancel }: { s: Session; code?: string; mandateId?: string; userId: string; lang: Lang; onCancel: (cycleId: string) => void }) {
  const cycle = mandateId ? (s.idx.cyclesByMandate.get(mandateId) ?? [])[0] : undefined;
  const active = mandateId ? s.state.mandateStatus.get(mandateId) === "active" : false;
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-[10px] bg-red-wash px-3 py-2 text-[16px] font-semibold text-red">{t(lang, "fraud.title")}</p>
      <ol className="flex flex-col gap-2">
        {(["fraud.step1", "fraud.step2", "fraud.step3"] as StringKey[]).map((k, i) => (
          <li key={k} className="flex gap-3 rounded-[12px] border border-line p-3 text-[15px]"><span className="font-bold text-navy">{i + 1}</span><span>{t(lang, k)}</span></li>
        ))}
      </ol>
      {cycle && active && <button onClick={() => onCancel(cycle.id)} className="h-12 rounded-full btn-primary text-[16px] font-semibold text-white">{t(lang, "choice.cancel")}</button>}
      {code && <p className="text-[14px] text-slate">{t(lang, "fraud.case", { code })}</p>}
    </div>
  );
}

// ---------- C10 ----------
function AskPakka({ s, userId, lang, onFraud, ask }: { s: Session; userId: string; lang: Lang; onFraud: (code?: string, mandateId?: string) => void; ask: (cycleId: string) => void }) {
  const send = useSync((x) => x.send);
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
    const c = (s.idx.cyclesByMandate.get(m.id) ?? []).reduce((a, b) => (b.seq > a.seq ? b : a));
    return { m, mer, plan, c };
  }, [answer, s]);
  const factsText = facts ? t(lang, "ask.facts", { legal: facts.mer.legalName, brand: facts.mer.brand, plan: facts.plan.name, amount: inr(facts.c.amount), when: `${dayMonth(facts.c.dueAt, lang)}, ${timeIST(facts.c.dueAt)}` }) : "";
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const live = await callModel<Omit<Intake, "modelVersion" | "review">>("intake", { text }, { userId, lang });
    // The classification is used when the model answered; the reply only when the review loop approved it.
    const intake: Intake | undefined = live?.output
      ? { ...live.output, modelVersion: live.promptVersion, review: live.review }
      : live?.review ? { ...intakeTemplate(text), review: live.review } : undefined;
    const r = (await send({ kind: "question", userId, text, intake })) as typeof answer;
    setBusy(false);
    setAnswer(r);
    setReply(live?.output?.reply && live.review && live.review.status !== "template" ? live.output.reply : null);
    if (r?.intent === "never_approved") onFraud(r.caseCode, r.mandateId);
  };
  if (!open) return (
    <button onClick={() => setOpen(true)} className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full btn-primary px-5 py-2.5 text-[15px] font-semibold text-white shadow-[var(--shadow-float)]">{t(lang, "ask.pill")}</button>
  );
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 max-h-[60%] overflow-y-auto border-t border-line bg-surface p-4 shadow-[var(--shadow-sheet)]">
      <div className="flex gap-2">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={t(lang, "ask.placeholder")}
          className="h-12 min-w-0 flex-1 rounded-[8px] border border-line-strong px-3 text-[16px]" />
        <button aria-label="Speak" className="flex h-12 w-12 items-center justify-center rounded-[8px] border border-line-strong text-navy"><Mic size={20} /></button>
        <button aria-label="Close" onClick={() => { setOpen(false); setAnswer(null); setReply(null); }} className="text-slate"><X size={20} /></button>
      </div>
      {busy && <p className="mt-2 text-[14px] text-slate">{t(lang, "button.working")}</p>}
      {reply && answer?.intent !== "never_approved" && (
        <div className="mt-3 flex items-start gap-3 rounded-[12px] bg-sky-soft p-3">
          <p className="flex-1 text-[15px]">{reply}</p>
          <ListenButton key={`${lang}|${reply}`} text={reply} lang={lang} />
        </div>
      )}
      {facts && answer?.intent !== "never_approved" && (
        <div className="mt-3 rounded-[12px] border border-line p-3">
          <div className="flex items-center gap-3"><MerchantTile brand={facts.mer.brand} tile={facts.mer.tile} /><div className="flex-1 text-[16px] font-semibold">{facts.mer.brand}</div><Amount paise={facts.c.amount} lang={lang} /></div>
          <div className="mt-2 flex items-start gap-3">
            <p className="flex-1 text-[15px]">{factsText}</p>
            {!reply && <ListenButton key={`${lang}|${factsText}`} text={factsText} lang={lang} />}
          </div>
          {needsAnswer({ cs: s.state.cycle(facts.c.id) } as Row) && <button onClick={() => ask(facts.c.id)} className="mt-3 h-11 w-full rounded-full btn-primary text-[15px] font-semibold text-white">{t(lang, "sheet.question")}</button>}
        </div>
      )}
      {answer && !answer.mandateId && (
        <div className="mt-3">
          <p className="text-[14px] text-slate">{t(lang, "ask.nomatch")}</p>
          {answer.candidates.map((id) => { const mer = s.merchantOf(id); return <button key={id} onClick={() => setAnswer({ ...answer, mandateId: id })} className="mt-1 block w-full rounded-[10px] border border-line p-2 text-left text-[15px]">{mer.brand}</button>; })}
        </div>
      )}
    </div>
  );
}

"use client";
// Pakka live, /live: the consumer app for a real person. Passkey account, their own AutoPays (typed or read
// from a bank SMS), their own clock, reminders written live by Sarvam in their language. The phone screens are
// the demo's own (PhoneScreens); only the host behind them differs. Only money is simulated.
import { useEffect, useState, type ReactNode } from "react";
import { Fingerprint, LogOut, MessageSquareText, Pause, Plus, Volume2 } from "lucide-react";
import { isUiLang, langInfo, type UiLang } from "@/copy/languages";
import { tr } from "@/copy/regional";
import type { StringKey } from "@/copy/strings";
import { AUTOPAY_KINDS, type AutopayInput } from "@/engine/live";
import { maxSkipsAllowed } from "@/engine/state";
import type { Session } from "@/engine/session";
import { inr, timeIST } from "@/lib/format";
import { useLive, type SmsDraft } from "@/lib/live-client";
import { recorderRow } from "@/lib/recorder";
import { speakWithSarvam, useRegional } from "@/lib/regional-client";
import { LangPicker } from "@/components/shared";
import { HostProvider, PhoneScreens } from "./ConsumerApp";

const errText = (lang: UiLang, code: string) => tr(lang, (ERR[`live.err.${code}`] ? `live.err.${code}` : "live.err.generic") as StringKey);
const ERR: Record<string, true> = { "live.err.NEXT_DUE_IN_PAST": true, "live.err.TRIAL_NOT_CHEAPER": true, "live.err.TRIAL_AFTER_DUE": true, "live.err.IN_USE": true, "live.err.PASSKEY_CANCELLED": true };

/** The server's clock on this device, ticking each second. Empty until mounted (no clock read while rendering). */
function useServerNow(skewMs: number) {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date(Date.now() + skewMs).toISOString());
    const first = setTimeout(tick, 0), i = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(i); };
  }, [skewMs]);
  return now;
}

export default function LiveApp() {
  const live = useLive();
  useRegional((x) => x.version);
  const now = useServerNow(live.skewMs);
  const [pickLang, setPickLang] = useState<UiLang>("hinglish");
  useEffect(() => {
    void useLive.getState().refresh().then(() => {
      try { const saved = localStorage.getItem("pakka-live-lang"); if (saved && isUiLang(saved)) setPickLang(saved); } catch { /* storage blocked */ }
    });
    // The server's clock keeps running; look again every 15 seconds and whenever the tab comes back.
    const i = setInterval(() => void useLive.getState().refresh(), 15_000);
    const back = () => document.visibilityState === "visible" && void useLive.getState().refresh();
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", back); };
  }, []);
  const lang: UiLang = live.profile?.uiLang ?? pickLang;
  useEffect(() => { void useRegional.getState().ensure(lang); }, [lang]);

  let body: ReactNode;
  if (live.phase === "loading" || (live.phase === "in" && !now)) body = <div className="p-8 text-slate">Loading</div>;
  else if (live.phase === "signed_out" || !live.session || !live.profile) body = <Welcome lang={lang} setLang={(l) => { setPickLang(l); try { localStorage.setItem("pakka-live-lang", l); } catch { /* storage blocked */ } }} />;
  else {
    const s = live.session, me = live.profile;
    body = (
      <HostProvider value={{ send: live.send, confirmTag: "live.tag.passkey" }}>
        <PhoneScreens s={s} userId={me.id} lang={lang} now={now} setLang={(l) => void live.setLang(l)}
          statusRight={<button onClick={() => void live.signOut()} className="flex items-center gap-1 text-slate" aria-label={tr(lang, "live.signout")}><LogOut size={14} aria-hidden />{tr(lang, "live.signout")}</button>}
          listTop={(open) => <LiveTop s={s} lang={lang} name={me.name} open={open} />}
          confirm={({ cycleId, choice, done }) => <PasskeyConfirm s={s} cycleId={cycleId} choice={choice} lang={lang} done={done} />} />
      </HostProvider>
    );
  }
  return (
    <main className="flex min-h-screen flex-col items-center gap-3 py-4 sm:py-6">
      <div className="h-[100dvh] w-full overflow-hidden sm:h-[844px] sm:w-[390px] sm:rounded-[36px] sm:border-[10px] sm:border-ink">
        <div dir={langInfo(lang).rtl ? "rtl" : "ltr"} lang={langInfo(lang).sarvam} className="h-full">{body}</div>
      </div>
    </main>
  );
}

// ---------- signed out ----------
function Welcome({ lang, setLang }: { lang: UiLang; setLang: (l: UiLang) => void }) {
  const { signUp, signIn } = useLive();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (fn: () => Promise<string | null>) => { setBusy(true); setErr(null); const e = await fn(); setBusy(false); if (e) setErr(e); };
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <header className="flex items-center justify-between bg-surface px-4 py-3 shadow-[0_1px_0_var(--line)]">
        <span className="text-[20px] font-bold text-navy">Pakka</span>
        <LangPicker lang={lang} onChange={setLang} />
      </header>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <h1 className="text-[24px] font-bold leading-8 text-navy">{tr(lang, "live.intro.title")}</h1>
        <p className="text-[16px] text-slate">{tr(lang, "live.intro.body")}</p>
        <p className="rounded-[10px] bg-amber-wash px-3 py-2 text-[14px] text-amber">{tr(lang, "live.sim")}</p>
        <label className="flex flex-col gap-1 text-[14px] font-semibold text-ink">{tr(lang, "live.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" className="h-12 rounded-[8px] border border-line-strong px-3 text-[16px] font-normal" />
        </label>
        <button disabled={busy || !name.trim()} onClick={() => go(() => signUp(name.trim(), lang))} className="flex h-12 items-center justify-center gap-2 rounded-full btn-primary text-[16px] font-semibold text-white disabled:bg-line-strong disabled:text-slate">
          <Fingerprint size={18} aria-hidden />{busy ? tr(lang, "button.working") : tr(lang, "live.signup")}
        </button>
        <button disabled={busy} onClick={() => go(signIn)} className="h-12 rounded-full border border-line-strong bg-surface text-[16px] font-semibold text-navy">{tr(lang, "live.signin")}</button>
        {err && <p role="alert" className="text-[14px] text-red">{errText(lang, err)}</p>}
      </div>
    </div>
  );
}

// ---------- the top of the list ----------
function LiveTop({ s, lang, name, open }: { s: Session; lang: UiLang; name: string; open: (node: ReactNode | null) => void }) {
  const nudges = s.state.nudges.slice(-3).reverse();
  const [showLog, setShowLog] = useState(false);
  const log = s.events.map((e) => recorderRow(s, e)).filter((r) => r !== null).slice(-12).reverse();
  const empty = s.world.mandates.length === 0;
  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-[17px] font-semibold text-ink">{tr(lang, "live.hello", { name: name.split(" ")[0] })}</p>
        <button onClick={() => open(<AddAutopay lang={lang} close={() => open(null)} />)} className="press inline-flex h-10 items-center gap-1.5 rounded-full btn-primary px-4 text-[15px] font-semibold text-white"><Plus size={16} aria-hidden />{tr(lang, "live.add")}</button>
      </div>
      <p className="text-[13.5px] text-slate">{tr(lang, "live.sim")}</p>
      {empty && <p className="card p-4 text-[15px] text-slate">{tr(lang, "live.empty")}</p>}
      {nudges.length > 0 && (
        <section className="card p-3">
          <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-slate"><MessageSquareText size={16} aria-hidden />{tr(lang, "live.messages")}</h2>
          <div className="flex flex-col divide-y divide-line">
            {nudges.map((n) => <Message key={n.eventId} title={n.title} body={n.body} at={n.at} language={n.language} model={n.modelVersion} lang={lang} />)}
          </div>
        </section>
      )}
      {log.length > 0 && (
        <section>
          <button onClick={() => setShowLog((x) => !x)} className="text-[14px] font-semibold text-navy underline">{tr(lang, "live.activity")}</button>
          {showLog && (
            <ol className="mt-2 flex flex-col gap-1 card p-3 text-[13.5px]" lang="en" dir="ltr">
              {log.map((r) => <li key={r!.id} className="flex gap-2"><span className="tnum w-16 shrink-0 text-slate">{timeIST(r!.at)}</span><span><b className="font-semibold">{r!.title}</b>{r!.detail ? `. ${r!.detail}` : ""}{r!.chip ? <span className="ml-1 text-slate">{r!.chip}</span> : null}</span></li>)}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

function Message({ title, body, at, language, model, lang }: { title: string; body: string; at: string; language: string; model: string; lang: UiLang }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const spoken: UiLang = isUiLang(language) ? language : lang;
  const listen = async () => {
    if (audio && state === "playing") { audio.pause(); setState("idle"); return; }
    setState("loading");
    const a = await speakWithSarvam(`${title}. ${body}`, spoken, () => setState("idle"));
    setAudio(a); setState(a ? "playing" : "idle");
  };
  return (
    <article className="flex flex-col gap-1 py-2" lang={langInfo(spoken).sarvam} dir={langInfo(spoken).rtl ? "rtl" : "ltr"}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15.5px] font-semibold text-ink">{title}</h3>
        <button onClick={listen} aria-label={tr(lang, "sheet.listen")} className="btn-soft inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold">{state === "idle" ? <Volume2 size={14} aria-hidden /> : <Pause size={14} aria-hidden />}{tr(lang, "sheet.listen")}</button>
      </div>
      <p className="text-[14.5px] text-slate">{body}</p>
      <p className="text-[12.5px] text-mist">{timeIST(at)}, {tr(lang, model.includes("sarvam") ? "live.message.by" : "live.message.template")}</p>
    </article>
  );
}

// ---------- adding an AutoPay ----------
const rupeesToPaise = (s: string) => { const n = Number(s.replace(/[,\s₹]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };

function AddAutopay({ lang, close }: { lang: UiLang; close: () => void }) {
  const { addAutopay, readSms } = useLive();
  const [sms, setSms] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [f, setF] = useState({ brand: "", legalName: "", amount: "", kind: "subscription" as AutopayInput["kind"], interval: "month" as AutopayInput["interval"], nextDue: "", trial: false, trialAmount: "1", trialStart: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const fromSms = async () => {
    setBusy(true); setNote(null);
    const r = await readSms(sms);
    setBusy(false);
    if ("error" in r) { setNote(tr(lang, "live.err.generic")); return; }
    const d: SmsDraft = r.draft;
    setF((x) => ({ ...x, brand: d.brand ?? x.brand, legalName: d.legalName ?? x.legalName, amount: d.amount ? String(d.amount / 100) : x.amount, kind: d.kind, interval: d.interval ?? x.interval, nextDue: d.nextDue ?? x.nextDue }));
    setNote(tr(lang, r.found ? "live.sms.found" : "live.sms.none"));
  };
  const save = async () => {
    setBusy(true); setErr(null);
    const e = await addAutopay({
      brand: f.brand.trim(), legalName: f.legalName.trim(), kind: f.kind, amount: rupeesToPaise(f.amount), interval: f.interval, nextDue: f.nextDue,
      trial: f.trial && f.trialStart ? { amount: rupeesToPaise(f.trialAmount), startedOn: f.trialStart } : null, source: sms.trim() ? "sms" : "typed",
    });
    setBusy(false);
    if (e) setErr(e); else close();
  };
  const field = "h-11 rounded-[8px] border border-line-strong bg-surface px-3 text-[16px] font-normal";
  const label = "flex flex-col gap-1 text-[14px] font-semibold text-ink";
  const ok = f.brand.trim() && rupeesToPaise(f.amount) >= 100 && /^\d{4}-\d{2}-\d{2}$/.test(f.nextDue);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[20px] font-bold text-navy">{tr(lang, "live.add.title")}</h2>
      <label className={label}>{tr(lang, "live.sms")}
        <textarea value={sms} onChange={(e) => setSms(e.target.value)} rows={3} maxLength={800} className="rounded-[8px] border border-line-strong p-3 text-[15px] font-normal" />
      </label>
      <button disabled={busy || !sms.trim()} onClick={fromSms} className="h-11 rounded-full border border-line-strong text-[15px] font-semibold text-navy disabled:text-mist">{busy ? tr(lang, "button.working") : tr(lang, "live.sms.read")}</button>
      {note && <p role="status" className="rounded-[10px] bg-canvas px-3 py-2 text-[14px] text-slate">{note}</p>}
      <label className={label}>{tr(lang, "live.f.brand")}<input value={f.brand} onChange={(e) => set("brand", e.target.value)} maxLength={40} className={field} /></label>
      <label className={label}>{tr(lang, "live.f.legal")}<input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} maxLength={80} className={field} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>{tr(lang, "live.f.amount")}<input value={f.amount} onChange={(e) => set("amount", e.target.value)} inputMode="decimal" className={field} /></label>
        <label className={label}>{tr(lang, "live.f.due")}<input type="date" value={f.nextDue} onChange={(e) => set("nextDue", e.target.value)} className={field} /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>{tr(lang, "live.f.kind")}
          <select value={f.kind} onChange={(e) => set("kind", e.target.value as AutopayInput["kind"])} className={field}>
            {AUTOPAY_KINDS.map((k) => <option key={k} value={k}>{tr(lang, `live.k.${k}` as StringKey)}</option>)}
          </select>
        </label>
        <label className={label}>{tr(lang, "live.f.interval")}
          <select value={f.interval} onChange={(e) => set("interval", e.target.value as AutopayInput["interval"])} className={field}>
            {(["month", "quarter", "year"] as const).map((k) => <option key={k} value={k}>{tr(lang, `live.f.${k}` as StringKey)}</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" checked={f.trial} onChange={(e) => set("trial", e.target.checked)} className="h-5 w-5" />{tr(lang, "live.f.trial")}</label>
      {f.trial && (
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>{tr(lang, "live.f.trialAmount")}<input value={f.trialAmount} onChange={(e) => set("trialAmount", e.target.value)} inputMode="decimal" className={field} /></label>
          <label className={label}>{tr(lang, "live.f.trialStart")}<input type="date" value={f.trialStart} onChange={(e) => set("trialStart", e.target.value)} className={field} /></label>
        </div>
      )}
      {err && <p role="alert" className="text-[14px] text-red">{errText(lang, err)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={close} className="h-12 rounded-full border border-line-strong text-[16px] font-semibold text-navy">{tr(lang, "live.notnow")}</button>
        <button disabled={busy || !ok} onClick={save} className="h-12 rounded-full btn-primary text-[16px] font-semibold text-white disabled:bg-line-strong disabled:text-slate">{busy ? tr(lang, "button.working") : tr(lang, "live.save")}</button>
      </div>
    </div>
  );
}

// ---------- pause or cancel: the passkey instead of a PIN ----------
function PasskeyConfirm({ s, cycleId, choice, lang, done }: { s: Session; cycleId: string; choice: "pause" | "cancel"; lang: UiLang; done: (status: string) => void }) {
  const confirm = useLive((x) => x.confirm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = s.idx.cycle.get(cycleId)!;
  const brand = s.merchantOf(c.mandateId).brand;
  const pauseWillCancel = choice === "pause" && s.state.skipsUsed(c.mandateId) >= maxSkipsAllowed();
  const go = async () => {
    setBusy(true); setErr(null);
    const r = await confirm(cycleId, choice);
    setBusy(false);
    if ("error" in r) setErr(r.error); else done(r.status);
  };
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-soft"><Fingerprint size={30} className="text-navy" aria-hidden /></span>
      <h2 className="text-[20px] font-bold text-navy">{tr(lang, "live.confirm.title")}</h2>
      <p className="text-[15px] text-slate">{tr(lang, choice === "pause" && !pauseWillCancel ? "live.confirm.pause.body" : "live.confirm.cancel.body", { brand })}</p>
      {pauseWillCancel && <p role="alert" className="rounded-[10px] bg-red-wash px-3 py-2 text-[14px] font-semibold text-red">{tr(lang, "choice.pause.warn_cancel", { brand, max: maxSkipsAllowed() })}</p>}
      <p className="text-[15px] font-semibold text-ink">{brand}, {inr(c.amount)}</p>
      {err && <p role="alert" className="text-[14px] text-red">{errText(lang, err)}</p>}
      <button disabled={busy} onClick={go} className="h-12 w-full rounded-full btn-primary text-[16px] font-semibold text-white">{busy ? tr(lang, "button.working") : tr(lang, "live.confirm.cta")}</button>
    </div>
  );
}

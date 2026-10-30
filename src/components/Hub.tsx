"use client";
// Hub, / (PRD 20.0): what Pakka is, the results, and a way into each surface and the demo session.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  BadgeCheck, Building2, ChevronRight, Clock, Eye, Gavel, Languages, Lock, Play, Radar, RefreshCw,
  ShieldCheck, Smartphone, Sparkles, Store, TrendingUp, Undo2, Volume2, Zap,
} from "lucide-react";
import { t } from "@/copy/strings";
import type { Lang } from "@/engine/types";
import { DebitTimeline, PakkaSeal } from "@/components/shared";
import { sessionIdFromUrl, SYNC_MODE } from "@/lib/sync/client";

const RESULTS = [
  { value: "₹1,59,334", label: "Unwanted charges stopped before they left", Icon: ShieldCheck, tile: "bg-sky-soft text-blue", tone: "text-navy" },
  { value: "₹55,016", label: "At-risk charges that still went through", Icon: TrendingUp, tile: "bg-green-wash text-green", tone: "text-green" },
  { value: "318", label: "People asked in Hindi, Hinglish or English", Icon: Languages, tile: "bg-amber-wash text-amber", tone: "text-navy" },
  { value: "₹0", label: "Moved without a rule. Always.", Icon: BadgeCheck, tile: "bg-navy-wash text-navy", tone: "text-navy" },
];

const GAPS = [
  { title: "Consent gap", Icon: Lock, tile: "bg-amber-wash text-amber", line: "The PIN that pays ₹1 for a trial also approves every ₹599 that follows.", fix: "One clear question the day before the first real charge." },
  { title: "Name gap", Icon: Building2, tile: "bg-sky-soft text-blue", line: "The bank SMS says Vidyakosh Learning Pvt Ltd. Nobody knows that is PadhoAI.", fix: "The brand shown next to the registered name, when verified." },
  { title: "Ownership gap", Icon: Eye, tile: "bg-green-wash text-green", line: "Service in one app, mandate in another, money in the bank. Nobody owns the night before.", fix: "Pakka owns the 24 hours and acts across all three." },
];

const STEPS = [
  { Icon: Radar, title: "Sense", body: "Pre-debit notices, failed charges and review spikes, as they happen." },
  { Icon: Zap, title: "Decide", body: "A transparent risk score with named reasons, plus the merchant's own rules." },
  { Icon: RefreshCw, title: "Act", body: "Ask the customer, skip via the merchant, refund, or book an off-peak retry." },
  { Icon: Gavel, title: "Verify", body: "Read the result back, tell the customer, record every step with a rule ID." },
];

export default function Hub() {
  const [id, setId] = useState("DEMO-7");
  const [qr, setQr] = useState("");
  useEffect(() => { setId(sessionIdFromUrl()); }, []);
  useEffect(() => {
    try { localStorage.setItem("pakka-session", id); } catch { /* storage blocked */ }
    const url = `${window.location.origin}/app?session=${id}&persona=sunita`;
    QRCode.toDataURL(url, { margin: 1, width: 160, color: { dark: "#002E6E", light: "#FFFFFF" } }).then(setQr).catch(() => setQr(""));
  }, [id]);
  const create = async () => {
    if (SYNC_MODE === "local") { setId(`DEMO-${10 + Math.floor(Math.random() * 90)}`); return; }
    const r = await fetch("/api/sessions", { method: "POST" }).then((x) => x.json());
    if (r.ok) setId(r.data.id);
  };
  const q = `session=${id}`;
  const surfaces = [
    { href: `/app?${q}`, title: "Customer app", who: "Sunita, Rahul, Farhan, Anjali", body: "The Doosri Haan sheet, the PIN step, retries and a verified callback.", Icon: Smartphone },
    { href: `/merchant?${q}`, title: "Merchant console", who: "Imran at PadhoAI", body: "A private alert, one toggle, and a checkout that changes live.", Icon: Store },
    { href: `/ops?${q}`, title: "Control room", who: "Priya on the trust team", body: "Incidents, cases and a flight recorder that explains every step.", Icon: ShieldCheck },
    { href: `/demo?${q}`, title: "Counters", who: "Judges and the stage", body: "The clock, the story steps and the numbers, all from the event log.", Icon: Clock },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-white/85 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-8">
          <PakkaSeal />
          <div className="ml-auto hidden items-center gap-7 text-[15px] font-medium text-slate md:flex">
            <a href="#how" className="hover:text-navy">How it works</a>
            <a href="#surfaces" className="hover:text-navy">Screens</a>
            <a href="#join" className="hover:text-navy">On your phone</a>
            <a href="/live" className="hover:text-navy">Try it for real</a>
            <a href="/business" className="hover:text-navy">For business</a>
          </div>
          <a href={`/demo?${q}&grid=1`} className="btn-primary ml-auto inline-flex h-10 items-center gap-2 rounded-full px-5 text-[15px] font-semibold md:ml-0">
            <Play size={16} aria-hidden />Open the demo
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="hero-glow">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-16 pt-12 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:pb-24 lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-sky-soft px-3.5 py-1.5 text-[14px] font-semibold text-blue">
              <Sparkles size={16} aria-hidden />An AI teammate for UPI AutoPay
            </p>
            <h1 className="mt-6 text-[38px] font-extrabold leading-[1.08] tracking-[-0.015em] text-navy sm:text-[52px]">
              Galat paisa nahi katega, <span className="text-blue">sahi paisa nahi rukega.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[18px] leading-7 text-slate">
              Pakka lives in the 24 hours before every AutoPay charge. It asks before the money moves, keeps the charges people want from failing, and brings in a person only when it matters.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href={`/demo?${q}&grid=1`} className="btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[16px] font-semibold">
                <Play size={18} aria-hidden />Watch the 3 minute story
              </a>
              <a href={`/app?${q}&persona=sunita`} className="press inline-flex items-center gap-2 rounded-full border border-line-strong bg-white px-6 py-3.5 text-[16px] font-semibold text-navy hover:border-blue">
                <Smartphone size={18} aria-hidden />Try Sunita&apos;s phone
              </a>
            </div>
            <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-[14px] font-medium text-slate">
              <li className="inline-flex items-center gap-2"><ShieldCheck size={18} className="text-green" aria-hidden />Never blocks a charge on its own</li>
              <li className="inline-flex items-center gap-2"><Languages size={18} className="text-blue" aria-hidden />Hindi first, with voice</li>
              <li className="inline-flex items-center gap-2"><Undo2 size={18} className="text-amber" aria-hidden />Refunds to the same account</li>
            </ul>
          </div>
          <HeroPhone />
        </div>
      </section>

      {/* Results */}
      <section className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="-mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {RESULTS.map(({ value, label, Icon, tile, tone }) => (
            <div key={label} className="card lift p-5">
              <span className={`flex h-10 w-10 items-center justify-center rounded-[12px] ${tile}`}><Icon size={20} strokeWidth={2} aria-hidden /></span>
              <div className={`tnum mt-4 text-[32px] font-extrabold leading-9 ${tone}`}>{value}</div>
              <div className="mt-1 text-[14px] leading-5 text-slate">{label}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[13px] text-slate">Results from the demo story, 26 Oct 8:55 PM to 29 Oct 6:00 AM. Computed from the event log, never typed in.</p>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[30px] font-bold leading-[38px] text-navy sm:text-[36px] sm:leading-[44px]">AutoPay doesn&apos;t have a fraud problem. It has a consent problem.</h2>
          <p className="mt-4 text-[17px] leading-7 text-slate">You pay ₹1 for a trial. The same PIN quietly approves ₹599 every month. About 2 crore mandates are revoked every month, and nobody owns the gap.</p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {GAPS.map(({ title, Icon, tile, line, fix }) => (
            <article key={title} className="card lift flex flex-col p-6">
              <span className={`flex h-12 w-12 items-center justify-center rounded-[14px] ${tile}`}><Icon size={24} strokeWidth={1.9} aria-hidden /></span>
              <h3 className="mt-5 text-[20px] font-bold text-ink">{title}</h3>
              <p className="mt-2 flex-1 text-[15px] leading-6 text-slate">{line}</p>
              <p className="mt-5 flex gap-2 rounded-[12px] bg-canvas p-3 text-[14.5px] font-semibold text-navy"><BadgeCheck size={20} className="shrink-0 text-green" aria-hidden />{fix}</p>
            </article>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-[30px] font-bold leading-[38px] text-navy sm:text-[36px] sm:leading-[44px]">AI where judgement lives. Rules where money moves.</h2>
            <p className="mt-4 text-[17px] leading-7 text-slate">The model writes, tags and summarises. It never moves money. Every action passes one gateway, carries a rule ID, and lands in the flight recorder.</p>
          </div>
          <ol className="relative mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <span aria-hidden className="absolute left-[12%] right-[12%] top-8 hidden h-0.5 bg-gradient-to-r from-sky/40 via-blue/40 to-sky/40 lg:block" />
            {STEPS.map(({ Icon, title, body }, i) => (
              <li key={title} className="relative text-center">
                <span className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-[var(--shadow-card)] ring-1 ring-line">
                  <Icon size={26} strokeWidth={1.9} className="text-blue" aria-hidden />
                  <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[12px] font-bold text-white">{i + 1}</span>
                </span>
                <h3 className="mt-4 text-[19px] font-bold text-ink">{title}</h3>
                <p className="mx-auto mt-2 max-w-[240px] text-[15px] leading-6 text-slate">{body}</p>
              </li>
            ))}
          </ol>
          <div className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-2">
            {["No charges 10 AM to 1 PM or 5 PM to 9:30 PM, per NPCI", "One attempt plus three retries, never a fifth", "Pause and cancel always need the customer's own PIN", "Merchant offers sit beside Cancel, never in front of it"].map((x) => (
              <p key={x} className="flex items-center gap-2.5 rounded-[14px] bg-canvas px-4 py-3 text-[15px] text-ink"><ShieldCheck size={18} className="shrink-0 text-green" aria-hidden />{x}</p>
            ))}
          </div>
        </div>
      </section>

      {/* Surfaces */}
      <section id="surfaces" className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[30px] font-bold text-navy sm:text-[36px]">Four screens, one story</h2>
            <p className="mt-2 text-[17px] text-slate">Open any of them on the same session. A tap in one shows up in the others.</p>
          </div>
          <a href={`/demo?${q}&grid=1`} className="btn-soft inline-flex h-10 items-center gap-1 rounded-full px-4 text-[15px] font-semibold">See them together<ChevronRight size={18} aria-hidden /></a>
        </div>
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {surfaces.map(({ href, title, who, body, Icon }) => (
            <li key={title}>
              <a href={href} className="card lift group flex h-full flex-col p-6">
                <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-gradient-to-br from-sky to-blue text-white shadow-[0_6px_16px_rgba(11,114,231,0.28)]"><Icon size={22} strokeWidth={1.9} aria-hidden /></span>
                <h3 className="mt-5 text-[19px] font-bold text-ink">{title}</h3>
                <p className="text-[14px] font-medium text-blue">{who}</p>
                <p className="mt-3 flex-1 text-[15px] leading-6 text-slate">{body}</p>
                <span className="mt-5 inline-flex items-center gap-1 text-[15px] font-semibold text-navy">Open<ChevronRight size={18} className="transition-transform group-hover:translate-x-1" aria-hidden /></span>
              </a>
            </li>
          ))}
        </ul>
        <a href="/live" className="card lift group mt-5 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-blue text-white"><Smartphone size={22} strokeWidth={1.9} aria-hidden /></span>
          <div className="flex-1">
            <h3 className="text-[19px] font-bold text-ink">Pakka live</h3>
            <p className="text-[14px] font-medium text-blue">Your own AutoPays, in your language</p>
            <p className="mt-2 text-[15px] leading-6 text-slate">Sign in with a passkey and add the AutoPays you really have, typed or read from a bank SMS. Pakka runs on the real clock, writes each reminder live with Sarvam in any of 24 languages, reads it aloud, and asks for your passkey before a pause or cancel. Only the money is simulated.</p>
          </div>
          <span className="inline-flex items-center gap-1 text-[15px] font-semibold text-navy">Open<ChevronRight size={18} className="transition-transform group-hover:translate-x-1" aria-hidden /></span>
        </a>
        <a href="/business" className="card lift group mt-5 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-navy text-white"><Building2 size={22} strokeWidth={1.9} aria-hidden /></span>
          <div className="flex-1">
            <h3 className="text-[19px] font-bold text-ink">Pakka for Business</h3>
            <p className="text-[14px] font-medium text-blue">Finance teams paying vendors</p>
            <p className="mt-2 text-[15px] leading-6 text-slate">AI agents plan vendor payouts in rupees. Money leaves only with a signed receipt the treasury guard checks itself, so a phishing email or a hijacked agent cannot redirect a payment. Try the three-day simulation, or the live system with passkeys and your own agents over the API.</p>
          </div>
          <span className="inline-flex items-center gap-1 text-[15px] font-semibold text-navy">Open<ChevronRight size={18} className="transition-transform group-hover:translate-x-1" aria-hidden /></span>
        </a>
      </section>

      {/* Join */}
      <section id="join" className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0A2A66] via-navy to-[#0B4FB0] p-6 text-white sm:p-10">
          <span aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-sky/25 blur-3xl" />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto]">
            <div>
              <h2 className="text-[28px] font-bold leading-9">Put Sunita&apos;s app on a real phone</h2>
              <p className="mt-2 max-w-xl text-[16px] leading-6 text-white/80">
                {SYNC_MODE === "local"
                  ? "Scan to open the customer app. The demo runs inside each browser, so the phone plays its own copy of the story; tabs in one browser stay in sync."
                  : "Scan on a phone on the same network. The phone joins this session, so Sunita's taps show up in the control room."}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <label htmlFor="session" className="text-[14px] font-semibold text-white/80">Session</label>
                <input id="session" value={id} onChange={(e) => setId(e.target.value.toUpperCase())} className="h-11 w-36 rounded-full border border-white/25 bg-white/10 px-4 text-[16px] font-semibold text-white" />
                <button onClick={create} className="press h-11 rounded-full bg-white px-5 text-[15px] font-semibold text-navy">New session</button>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-[20px] bg-white p-4 text-ink">
              {qr ? <img src={qr} alt={`QR code to open session ${id} on a phone`} width={150} height={150} className="rounded-[10px]" /> : <div className="h-[150px] w-[150px] rounded-[10px] bg-line" />}
              <div className="max-w-[130px] text-[14px] text-slate"><b className="block text-[16px] text-navy">{id}</b>Opens as Sunita in Kanpur, in Hindi.</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-8 text-[14px] text-slate sm:px-8">
          <PakkaSeal />
          <span>Built on rules that already exist: RBI e-mandate framework, NPCI AutoPay rules, the 2023 dark pattern guidelines and the DPDP Act. Prototype; all merchants and people are fictional.</span>
        </div>
      </footer>
    </div>
  );
}

/** Interactive preview of the hero screen: Sunita's sheet, in three languages, with choices you can tap. */
function HeroPhone() {
  const [lang, setLang] = useState<Lang>("hinglish");
  const [pick, setPick] = useState<number | null>(1);
  const t0 = Date.parse("2026-10-26T15:40:00Z");
  const t1 = Date.parse("2026-10-27T16:00:00Z");
  const p = { day: lang === "hi" ? "कल" : lang === "en" ? "tomorrow" : "Kal", amount: "₹599", brand: "PadhoAI", trialDate: lang === "hi" ? "18 अक्टूबर" : "18 Oct", trialAmount: "₹1" };
  const options = [
    { title: t(lang, "choice.keep"), desc: t(lang, "choice.keep.desc", p) },
    { title: t(lang, "choice.skip"), desc: t(lang, "choice.skip.desc"), offer: true },
    { title: t(lang, "choice.pause"), desc: t(lang, "choice.pause.desc"), pin: true },
    { title: t(lang, "choice.cancel"), desc: t(lang, "choice.cancel.desc", p), pin: true },
  ];
  return (
    <div className="relative mx-auto w-full max-w-[360px]">
      <div className="mb-4 flex justify-center gap-1 rounded-full bg-white p-1 shadow-[var(--shadow-card)] ring-1 ring-line" role="tablist" aria-label="Preview language">
        {([["hi", "हिंदी"], ["hinglish", "Hinglish"], ["en", "English"]] as const).map(([l, label]) => (
          <button key={l} role="tab" aria-selected={lang === l} onClick={() => setLang(l)} className={`press h-9 flex-1 rounded-full text-[14px] font-semibold ${lang === l ? "bg-navy text-white" : "text-slate hover:text-navy"}`}>{label}</button>
        ))}
      </div>
      <div className="absolute -right-[156px] top-[250px] z-10 hidden w-40 rounded-[16px] bg-white p-3 shadow-[var(--shadow-card-hover)] xl:block">
        <p className="text-[12px] font-medium text-slate">Risk score</p>
        <p className="text-[24px] font-extrabold leading-7 text-navy">90<span className="text-[13px] font-semibold text-slate"> / 100</span></p>
        <div className="mt-1.5 h-1.5 rounded-full bg-line"><div className="h-1.5 w-[90%] rounded-full bg-gradient-to-r from-sky to-blue" /></div>
        <p className="mt-1.5 text-[11px] text-slate">Trial jump, app not opened, name gap</p>
      </div>
      <div className="absolute -right-[150px] bottom-44 z-10 hidden items-center gap-2 rounded-[16px] bg-white p-3 shadow-[var(--shadow-card-hover)] xl:flex">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-wash text-green"><BadgeCheck size={18} aria-hidden /></span>
        <span className="text-[13px] font-semibold text-ink">Skip needs<br />no PIN</span>
      </div>
      <div className="rounded-[40px] bg-[#0B1730] p-2.5 shadow-[0_40px_80px_rgba(0,46,110,0.28)]">
        <div className="overflow-hidden rounded-[32px] bg-surface text-ink">
          <div className="bg-gradient-to-br from-sky to-blue px-4 pb-4 pt-3 text-white">
            <div className="flex items-center justify-between text-[12px] font-semibold"><span>9:12</span><span className="opacity-80">4G</span></div>
            <div className="mt-3 rounded-[14px] bg-white/15 p-3">
              <PakkaSeal onNavy />
              <p className="mt-1.5 text-[14px] font-semibold leading-5">{t(lang, "push.ask", p)}</p>
            </div>
          </div>
          <div className="px-4 pb-5 pt-3">
            <div className="flex items-center justify-between">
              <PakkaSeal />
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-soft px-2.5 py-1 text-[12px] font-semibold text-blue"><Volume2 size={14} aria-hidden />{t(lang, "sheet.listen")}</span>
            </div>
            <p className="mt-2 text-[19px] font-bold leading-6 text-navy">{t(lang, "sheet.title", p)}</p>
            <p className="mt-1 text-[13px] text-slate">{t(lang, "sheet.lede.trial_unused", p)}</p>
            <div className="mt-3"><DebitTimeline startMs={t0} endMs={t1} nowMs={t0 + (t1 - t0) * 0.1} variant="compact" /></div>
            <div className="mt-3 flex flex-col gap-1.5" role="radiogroup" aria-label="Choices">
              {options.map((o, i) => {
                const sel = pick === i;
                return (
                  <button key={i} role="radio" aria-checked={sel} onClick={() => setPick(i)} className={`press flex gap-2.5 rounded-[12px] border px-2.5 py-2 text-left ${sel ? "border-blue bg-sky-soft/60 shadow-[0_0_0_1px_var(--blue)]" : "border-line-strong hover:border-blue/50"}`}>
                    <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${sel ? "border-[5px] border-blue" : "border-line-strong"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{o.title}</span>
                      <span className="block truncate text-[12px] text-slate">{o.desc}</span>
                    </span>
                    {o.offer && <span className="self-start whitespace-nowrap rounded-full bg-offer-wash px-1.5 text-[11px] font-semibold text-offer">{t(lang, "tag.offer", p)}</span>}
                    {o.pin && <Lock size={14} className="mt-0.5 shrink-0 text-slate" aria-label={t(lang, "tag.pin")} />}
                  </button>
                );
              })}
            </div>
            <div className={`mt-3 flex h-11 items-center justify-center rounded-full text-[14px] font-semibold ${pick === null ? "bg-line-strong text-slate" : "btn-primary"}`}>
              {pick === null ? t(lang, "button.choose") : options[pick].title}
            </div>
            <p className="mt-2 text-center text-[11px] text-slate">{t(lang, "ai.footer")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";
// Hub, / (PRD 20.0): what Pakka is, the results, and a way into each surface and the demo session.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { BadgeCheck, Building2, Clock, Eye, Gavel, Lock, MessageCircleQuestion, Play, Radar, RefreshCw, ShieldCheck, Smartphone, Store, Volume2, Zap } from "lucide-react";
import { DebitTimeline, PakkaSeal } from "@/components/shared";
import { sessionIdFromUrl, SYNC_MODE } from "@/lib/sync/client";

const RESULTS = [
  { value: "₹1,59,334", label: "Unwanted charges stopped before they left", tone: "text-white" },
  { value: "₹55,016", label: "At-risk charges that still went through", tone: "text-[#7EE2B8]" },
  { value: "318", label: "People asked, in Hindi, Hinglish or English", tone: "text-white" },
  { value: "0", label: "Rupees moved without a rule", tone: "text-cyan" },
];

const GAPS = [
  { title: "Consent gap", Icon: Lock, line: "The PIN that pays ₹1 for a trial also approves every ₹599 that follows.", fix: "One clear question the day before the first real charge." },
  { title: "Name gap", Icon: Building2, line: "The bank SMS says Vidyakosh Learning Pvt Ltd. Nobody knows that is PadhoAI.", fix: "Show the brand next to the registered name, only when verified." },
  { title: "Ownership gap", Icon: Eye, line: "Service in the app, mandate in the UPI app, money in the bank. Nobody owns the night before.", fix: "Pakka owns the 24 hours and acts across all three." },
];

const STEPS = [
  { Icon: Radar, title: "Sense", body: "Pre-debit notices, failed charges and review spikes, as they happen." },
  { Icon: Zap, title: "Decide", body: "A transparent risk score with named reasons, plus the merchant's own rules." },
  { Icon: RefreshCw, title: "Act", body: "Ask the customer, skip via the merchant, refund, or book an off-peak retry." },
  { Icon: Gavel, title: "Verify and explain", body: "Read the state back, tell the customer, and record every step with a rule ID." },
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
    { href: `/merchant?${q}`, title: "Merchant console", who: "Imran at PadhoAI", body: "A private alert, one toggle, and a checkout preview that changes live.", Icon: Store },
    { href: `/ops?${q}`, title: "Control room", who: "Priya on the trust team", body: "Incidents, cases and a flight recorder that explains every step.", Icon: ShieldCheck },
    { href: `/demo?${q}`, title: "Demo view", who: "Judges and the stage", body: "The clock, the six story steps and the counters, all from the event log.", Icon: Clock },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy/95 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-8">
          <PakkaSeal onNavy />
          <div className="ml-auto hidden items-center gap-6 text-[15px] font-medium text-white/80 md:flex">
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#surfaces" className="hover:text-white">Screens</a>
            <a href="#join" className="hover:text-white">Join on a phone</a>
          </div>
          <a href={`/demo?${q}&grid=1`} className="ml-auto inline-flex h-10 items-center gap-2 rounded-[10px] bg-white px-4 text-[15px] font-semibold text-navy md:ml-0">
            <Play size={16} aria-hidden />Open the demo
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[14px] font-medium text-white/90">
              <span className="h-2 w-2 rounded-full bg-cyan" />An AI teammate for UPI AutoPay
            </p>
            <h1 className="mt-6 text-[36px] font-extrabold leading-[1.1] tracking-[-0.01em] sm:text-[56px] sm:leading-[1.08]">
              Galat paisa nahi katega, sahi paisa nahi rukega.
            </h1>
            <p className="mt-5 max-w-xl text-[18px] leading-7 text-white/80">
              Pakka lives in the 24 hours between a bank&apos;s pre-debit notice and the charge. It asks before the money moves, keeps the charges people want from failing, and hands the hard cases to a person.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href={`/demo?${q}&grid=1`} className="inline-flex h-12 items-center gap-2 rounded-[10px] bg-white px-5 text-[16px] font-semibold text-navy hover:bg-cyan-wash">
                <Play size={18} aria-hidden />Watch the 3 minute story
              </a>
              <a href={`/app?${q}&persona=sunita`} className="inline-flex h-12 items-center gap-2 rounded-[10px] border border-white/30 px-5 text-[16px] font-semibold text-white hover:bg-white/10">
                <Smartphone size={18} aria-hidden />Try Sunita&apos;s phone
              </a>
            </div>
            <p className="mt-6 text-[14px] text-white/60">Prototype. Every merchant and person is fictional. No real money moves.</p>
          </div>
          <HeroPhone />
        </div>
      </section>

      {/* Results */}
      <section className="relative z-10 mx-auto -mt-10 max-w-6xl px-4 sm:px-8">
        <div className="grid overflow-hidden rounded-[16px] bg-ink text-white shadow-[var(--shadow-float)] sm:grid-cols-2 lg:grid-cols-4">
          {RESULTS.map((r, i) => (
            <div key={r.label} className={`p-6 ${i ? "border-t border-white/10 sm:border-l sm:border-t-0" : ""} ${i === 2 ? "sm:border-l-0 sm:border-t lg:border-l lg:border-t-0" : ""}`}>
              <div className={`tnum text-[34px] font-extrabold leading-10 ${r.tone}`}>{r.value}</div>
              <div className="mt-1 text-[14px] leading-5 text-white/70">{r.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[13px] text-slate">Demo results from 26 Oct, 8:55 PM to 29 Oct, 6:00 AM. Computed from the event log, never typed in.</p>
      </section>

      {/* The problem */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
        <div className="max-w-2xl">
          <h2 className="text-[32px] font-bold leading-10 text-navy">AutoPay doesn&apos;t have a fraud problem. It has a consent problem.</h2>
          <p className="mt-3 text-[17px] leading-7 text-slate">You pay ₹1 for a trial. The same PIN quietly approves ₹599 every month. About 2 crore mandates are revoked every month, and nobody owns the gap.</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {GAPS.map(({ title, Icon, line, fix }) => (
            <article key={title} className="flex flex-col rounded-[16px] border border-line bg-surface p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-navy-wash text-navy"><Icon size={22} strokeWidth={1.8} aria-hidden /></span>
              <h3 className="mt-5 text-[20px] font-bold text-ink">{title}</h3>
              <p className="mt-2 flex-1 text-[15px] leading-6 text-slate">{line}</p>
              <p className="mt-5 flex gap-2 border-t border-line pt-4 text-[15px] font-semibold text-navy"><BadgeCheck size={20} className="shrink-0 text-green" aria-hidden />{fix}</p>
            </article>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <h2 className="text-[32px] font-bold leading-10 text-navy">AI where judgement lives. Rules where money moves.</h2>
              <p className="mt-3 text-[17px] leading-7 text-slate">The language model writes, tags and summarises. It never moves money. Every action passes one gateway, carries a rule ID, and lands in the flight recorder.</p>
              <div className="mt-6 rounded-[12px] bg-canvas p-4">
                <p className="text-[14px] font-semibold text-ink">Respects the rails</p>
                <ul className="mt-2 space-y-1.5 text-[14px] text-slate">
                  <li>No charges 10 AM to 1 PM or 5 PM to 9:30 PM</li>
                  <li>One attempt plus three retries, never a fifth</li>
                  <li>Pause and cancel always need the customer&apos;s own PIN</li>
                  <li>Refunds only to the original UPI account</li>
                </ul>
              </div>
            </div>
            <ol className="grid gap-4 sm:grid-cols-2">
              {STEPS.map(({ Icon, title, body }, i) => (
                <li key={title} className="rounded-[16px] border border-line p-6">
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-cyan-wash text-navy"><Icon size={22} strokeWidth={1.8} aria-hidden /></span>
                    <span className="text-[14px] font-semibold text-mist">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-5 text-[19px] font-bold text-ink">{title}</h3>
                  <p className="mt-2 text-[15px] leading-6 text-slate">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Surfaces */}
      <section id="surfaces" className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[32px] font-bold leading-10 text-navy">Four screens, one story</h2>
            <p className="mt-2 text-[17px] text-slate">Each opens on the same demo session, so a tap in one shows up in the others.</p>
          </div>
          <a href={`/demo?${q}&grid=1`} className="text-[15px] font-semibold text-navy underline underline-offset-4">See all four at once</a>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {surfaces.map(({ href, title, who, body, Icon }) => (
            <li key={title}>
              <a href={href} className="group flex h-full flex-col rounded-[16px] border border-line bg-surface p-6 transition-colors hover:border-navy">
                <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-navy text-white"><Icon size={22} strokeWidth={1.8} aria-hidden /></span>
                <h3 className="mt-5 text-[19px] font-bold text-ink">{title}</h3>
                <p className="text-[14px] font-medium text-slate">{who}</p>
                <p className="mt-3 flex-1 text-[15px] leading-6 text-slate">{body}</p>
                <span className="mt-5 text-[15px] font-semibold text-navy group-hover:underline">Open</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {/* Join */}
      <section id="join" className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        <div className="grid items-center gap-8 rounded-[20px] border border-line bg-surface p-6 sm:p-10 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-[28px] font-bold leading-9 text-navy">Put Sunita&apos;s app on a real phone</h2>
            <p className="mt-2 max-w-xl text-[16px] leading-6 text-slate">
              {SYNC_MODE === "local"
                ? "Scan the code to open the customer app. The demo runs inside each browser, so the phone plays its own copy of the story, and tabs in this browser stay in sync."
                : "Scan the code on a phone on the same network. The phone joins this session, so Sunita's taps show up in the control room."}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <label htmlFor="session" className="text-[14px] font-semibold text-slate">Session</label>
              <input id="session" value={id} onChange={(e) => setId(e.target.value.toUpperCase())} className="h-11 w-36 rounded-[8px] border border-line-strong px-3 text-[16px] font-semibold text-ink" />
              <button onClick={create} className="h-11 rounded-[10px] border border-line-strong px-4 text-[15px] font-semibold text-navy hover:border-navy">Start a new session</button>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-[16px] bg-canvas p-4">
            {qr ? <img src={qr} alt={`QR code to open session ${id} on a phone`} width={160} height={160} className="rounded-[10px]" /> : <div className="h-40 w-40 rounded-[10px] bg-line" />}
            <div className="max-w-[140px] text-[14px] text-slate"><b className="block text-ink">{id}</b>Opens as Sunita in Kanpur, in Hindi.</div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-8 text-[14px] text-slate sm:px-8">
          <PakkaSeal />
          <span>Built on rules that already exist: RBI e-mandate framework, NPCI AutoPay execution rules, the 2023 dark pattern guidelines and the DPDP Act.</span>
          <span className="sm:ml-auto">Paytm Build for India AI Hackathon, Problem Statement 3</span>
        </div>
      </footer>
    </div>
  );
}

/** A static preview of the hero screen: Sunita's Doosri Haan sheet. */
function HeroPhone() {
  const t0 = Date.parse("2026-10-26T15:40:00Z");
  const t1 = Date.parse("2026-10-27T16:00:00Z");
  const options: { title: string; desc: string; tag?: "offer" | "pin"; selected?: boolean }[] = [
    { title: "Chalne do", desc: "Plan chalu rahega, kal ₹599 katenge" },
    { title: "Is mahine skip karo", desc: "Is mahine paisa nahi, plan chalu", tag: "offer", selected: true },
    { title: "Pause karo", desc: "Jab tak wapas chalu na karein", tag: "pin" },
    { title: "AutoPay band karo", desc: "Aage se PadhoAI paisa nahi le payega", tag: "pin" },
  ];
  return (
    <div className="relative mx-auto w-full max-w-[360px]" aria-label="Preview of Sunita's decision sheet">
      <div className="absolute -left-24 top-[310px] z-10 hidden rounded-[12px] bg-white px-3 py-2 text-[13px] font-semibold text-ink shadow-[var(--shadow-float)] xl:block">
        <span className="text-slate">Risk score</span> <span className="text-navy">90</span>
      </div>
      <div className="absolute -right-24 bottom-40 z-10 hidden rounded-[12px] bg-white px-3 py-2 text-[13px] font-semibold text-ink shadow-[var(--shadow-float)] xl:block">
        <span className="text-green">No PIN</span> <span className="text-slate">for skip</span>
      </div>
      <div className="rounded-[36px] border-[10px] border-[#0B1730] bg-surface text-ink shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
        <div className="rounded-t-[26px] bg-canvas px-4 pb-3 pt-3">
          <div className="flex items-center justify-between text-[12px] font-semibold"><span>9:12</span><span className="text-slate">4G</span></div>
          <div className="mt-3 rounded-[12px] bg-navy p-3 text-white">
            <PakkaSeal onNavy />
            <p className="mt-1.5 text-[14px] font-semibold">Kal ₹599 PadhoAI ko jaayenge. Aapka jawab chahiye.</p>
          </div>
        </div>
        <div className="rounded-b-[26px] px-4 pb-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
          <div className="flex items-center justify-between">
            <PakkaSeal />
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-wash px-2.5 py-1 text-[12px] font-semibold text-navy"><Volume2 size={14} aria-hidden />Hindi mein sunein</span>
          </div>
          <p className="mt-2 text-[19px] font-bold leading-6 text-navy">Kal ₹599 PadhoAI ko jaayenge</p>
          <p className="mt-1 text-[13px] text-slate">18 Oct ko aapne ₹1 ka trial liya tha. Uske baad PadhoAI app nahi khula.</p>
          <div className="mt-3"><DebitTimeline startMs={t0} endMs={t1} nowMs={t0 + (t1 - t0) * 0.08} left={["Aaj 9:10 PM", "Aapko bataya"]} right={["Kal 9:30 PM ke baad", "₹599 katega"]} /></div>
          <p className="mt-3 flex gap-1.5 rounded-[8px] bg-canvas px-2.5 py-2 text-[12px]"><ShieldCheck size={16} className="shrink-0 text-green" aria-hidden /><span>Bank SMS mein naam <b>Vidyakosh Learning Pvt Ltd</b> aayega. Ye PadhoAI ki company hai.</span></p>
          <div className="mt-3 flex flex-col gap-1.5">
            {options.map((o) => (
              <div key={o.title} className={`flex gap-2.5 rounded-[10px] border px-2.5 py-2 ${o.selected ? "border-navy bg-[#FBFDFF] shadow-[0_0_0_1px_var(--navy)]" : "border-line-strong"}`}>
                <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${o.selected ? "border-[5px] border-navy" : "border-line-strong"}`} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{o.title}</span>
                  <span className="block truncate text-[12px] text-slate">{o.desc}</span>
                </span>
                {o.tag === "offer" && <span className="ml-auto self-start whitespace-nowrap rounded-full bg-offer-wash px-1.5 text-[11px] font-semibold text-offer">PadhoAI ka offer</span>}
                {o.tag === "pin" && <Lock size={14} className="ml-auto mt-0.5 shrink-0 text-slate" aria-label="UPI PIN lagega" />}
              </div>
            ))}
          </div>
          <div className="mt-3 flex h-10 items-center justify-center rounded-[10px] bg-navy text-[14px] font-semibold text-white">Is mahine skip karo</div>
          <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-slate"><MessageCircleQuestion size={12} aria-hidden />Pakka AI se chalta hai. Aap jo chunenge, wahi hoga.</p>
        </div>
      </div>
    </div>
  );
}

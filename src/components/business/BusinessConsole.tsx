"use client";
// Pakka for Business, /business: the finance team's console for AI-run vendor payouts. Every surface reads the
// same in-browser ledger; nothing here can move money except by sending a command the engine checks.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot, Building2, FileText, Gavel, Inbox, Landmark, LayoutDashboard, Link2, Pause, Play, RotateCcw, ShieldCheck, Snowflake, Swords, TriangleAlert,
} from "lucide-react";
import { addMin, B2B_END, B2B_MOMENTS, B2B_START } from "@/b2b/clock";
import { verifyChain } from "@/b2b/ledger";
import { b2bMetrics } from "@/b2b/metrics";
import type { Treasury } from "@/b2b/treasury";
import { KAVERI, SAANJH } from "@/b2b/world";
import { describe } from "@/lib/b2b/describe";
import { useB2B } from "@/lib/b2b/store";
import { dayMonth, inr, timeIST } from "@/lib/format";
import { PakkaSeal } from "@/components/shared";
import { Bar, Card, Hash, Money, Pill, Rule } from "./ui";
import { ApprovalsPage, BankChangesPage, GovernancePage, LedgerPage, PayablesPage, RedTeamPage } from "./BusinessPages";

export type Page = "overview" | "payables" | "approvals" | "bank" | "governance" | "redteam" | "ledger";
const NAV: { id: Page; label: string; Icon: typeof Inbox }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "payables", label: "Payables", Icon: FileText },
  { id: "approvals", label: "Approvals", Icon: Gavel },
  { id: "bank", label: "Bank changes", Icon: Landmark },
  { id: "governance", label: "Policy and keys", Icon: ShieldCheck },
  { id: "redteam", label: "Red team", Icon: Swords },
  { id: "ledger", label: "Ledger", Icon: Link2 },
];

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const whenIST = (at: string) => `${WEEKDAY[new Date(new Date(at).getTime() + 330 * 60_000).getUTCDay()]} ${dayMonth(at, "en")}, ${timeIST(at)}`;

export default function BusinessConsole() {
  const init = useB2B((s) => s.init);
  const ready = useB2B((s) => s.ready);
  useB2B((s) => s.version);
  const treasuries = useB2B((s) => s.treasuries);
  const failures = useB2B((s) => s.failures);
  const [co, setCo] = useState(SAANJH);
  const [page, setPage] = useState<Page>("overview");
  const [actAs, setActAs] = useState("p_arjun");
  useEffect(() => { init(); }, [init]);
  const t = treasuries[co];
  if (!ready || !t) return <div className="p-8 text-slate">Loading</div>;
  const people = t.world.people.filter((p) => p.companyId === co);
  const me = people.find((p) => p.id === actAs) ?? people[1];
  const pendingForMe = [...t.state.intents.values()].filter((it) => it.status === "awaiting_approval" && it.needs.some((r) => me.roles.includes(r) && !it.approvals.some((a) => a.role === r))).length;
  const openChanges = [...t.state.changeRequests.values()].filter((c) => c.status === "open").length;
  const company = t.world.companies.find((c) => c.id === co)!;

  return (
    <div className="min-h-screen bg-canvas">
      <Header t={t} co={co} setCo={(c) => { setCo(c); setActAs(c === SAANJH ? "p_arjun" : "p_lata"); }} me={me.id} setMe={setActAs} people={people} />
      {failures.length > 0 && <div className="bg-red-wash px-6 py-2 text-[14px] font-semibold text-red">Invariant failed: {failures[0]}</div>}
      {t.state.frozen.on && (
        <div className="flex items-center gap-2 bg-amber-wash px-6 py-2 text-[14px] text-amber"><Snowflake size={16} aria-hidden /><b>All payouts frozen</b> by {t.state.frozen.by}: {t.state.frozen.reason}. Two governors must sign to lift it.</div>
      )}
      <div className="mx-auto flex max-w-[1400px]">
        <nav className="sticky top-[64px] hidden h-[calc(100vh-64px)] w-[232px] shrink-0 border-r border-line bg-surface lg:block">
          <div className="flex items-center gap-3 border-b border-line p-4">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] font-bold" style={{ background: company.tile.bg, color: company.tile.fg }}>{company.brand[0]}</span>
            <div><div className="text-[15px] font-semibold leading-5">{company.brand}</div><div className="text-[12.5px] text-slate">{company.city}</div></div>
          </div>
          <ul className="py-2">
            {NAV.map(({ id, label, Icon }) => (
              <li key={id}>
                <button onClick={() => setPage(id)} className={`flex h-10 w-full items-center gap-3 border-l-[3px] px-4 text-[15px] ${page === id ? "border-cyan bg-cyan-wash font-semibold text-navy" : "border-transparent font-medium text-slate hover:text-ink"}`}>
                  <Icon size={17} aria-hidden />{label}
                  {id === "approvals" && pendingForMe > 0 && <span className="ml-auto rounded-full bg-amber-wash px-2 text-[12px] font-semibold text-amber">{pendingForMe}</span>}
                  {id === "bank" && openChanges > 0 && <span className="ml-auto rounded-full bg-amber-wash px-2 text-[12px] font-semibold text-amber">{openChanges}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 px-4 pb-10 pt-5 sm:px-8">
          <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
            {NAV.map(({ id, label }) => <button key={id} onClick={() => setPage(id)} className={`h-8 shrink-0 rounded-full px-3 text-[13.5px] font-semibold ${page === id ? "bg-navy text-white" : "border border-line bg-surface text-slate"}`}>{label}</button>)}
          </div>
          {page === "overview" && <Overview t={t} go={setPage} />}
          {page === "payables" && <PayablesPage t={t} at={useB2B.getState().doc.at} />}
          {page === "approvals" && <ApprovalsPage t={t} me={me} />}
          {page === "bank" && <BankChangesPage t={t} me={me} />}
          {page === "governance" && <GovernancePage t={t} me={me} />}
          {page === "redteam" && <RedTeamPage />}
          {page === "ledger" && <LedgerPage t={t} />}
        </main>
      </div>
    </div>
  );
}

function Header({ t, co, setCo, me, setMe, people }: { t: Treasury; co: string; setCo: (c: string) => void; me: string; setMe: (p: string) => void; people: Treasury["world"]["people"] }) {
  const at = useB2B((s) => s.doc.at);
  const setTime = useB2B((s) => s.setTime);
  const reset = useB2B((s) => s.reset);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const now = useB2B.getState().doc.at;
      if (now >= B2B_END) { setPlaying(false); return; }
      useB2B.getState().setTime(addMin(now, 5));
    }, 200);
    return () => clearInterval(id);
  }, [playing]);
  const next = B2B_MOMENTS.find((m) => m.at > at);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-[64px] max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:px-8">
        <Link href="/" className="flex items-center gap-2"><PakkaSeal /><span className="text-[14px] font-semibold text-slate">for Business</span></Link>
        <span className="rounded-full bg-amber-wash px-2 text-[12.5px] font-semibold text-amber">Simulation</span>
        <Link href="/business/live" className="text-[13.5px] font-semibold text-navy underline">Open the live system</Link>
        <div className="flex rounded-full border border-line p-0.5" role="tablist" aria-label="Company">
          {[SAANJH, KAVERI].map((c) => (
            <button key={c} role="tab" aria-selected={co === c} onClick={() => setCo(c)} className={`h-8 rounded-full px-3 text-[13.5px] font-semibold ${co === c ? "bg-navy text-white" : "text-slate"}`}>
              {t.world.companies.find((x) => x.id === c)!.brand}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="tnum mr-1 text-[15px] font-semibold text-ink" aria-live="polite">{whenIST(at)}</span>
          <button onClick={() => setPlaying(!playing)} className="btn-soft flex h-8 items-center gap-1 rounded-full px-3 text-[13.5px] font-semibold" aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}{playing ? "Pause" : "Play"}</button>
          <button onClick={() => setTime(addMin(at, 60))} className="h-8 rounded-full border border-line px-3 text-[13.5px] font-semibold text-navy">Add 1 hour</button>
          {next && <button onClick={() => setTime(next.at)} className="btn-primary h-8 rounded-full px-3 text-[13.5px] font-semibold" title={whenIST(next.at)}>Next: {next.label}</button>}
          <button onClick={() => { setPlaying(false); reset(); }} className="flex h-8 items-center gap-1 rounded-full px-2 text-[13px] font-semibold text-slate" aria-label="Start again"><RotateCcw size={14} aria-hidden />Start again</button>
          <label className="ml-2 flex items-center gap-2 text-[13.5px] text-slate">Acting as
            <select value={me} onChange={(e) => setMe(e.target.value)} className="h-8 rounded-[8px] border border-line-strong bg-surface px-2 text-[13.5px] font-semibold text-ink">
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}, {p.roles.join(" and ")}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="h-[3px] bg-[#EEF1F5]"><div className="h-full bg-navy" style={{ width: `${((new Date(at).getTime() - new Date(B2B_START).getTime()) / (new Date(B2B_END).getTime() - new Date(B2B_START).getTime())) * 100}%` }} /></div>
    </header>
  );
}

function Overview({ t, go }: { t: Treasury; go: (p: Page) => void }) {
  const m = b2bMetrics(t);
  const st = t.state;
  const at = useB2B((s) => s.doc.at);
  const day = t.dayKey(at);
  const chain = useMemo(() => verifyChain(t.events), [t.events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const recent = t.events.filter((e) => !["attested", "step_up", "grn_received"].includes(e.type)).slice(-14).reverse();
  const company = t.world.companies.find((c) => c.id === t.companyId)!;
  const msme = t.events.filter((e) => e.type === "msme_alert");
  const fraud = [...st.cases.values()].filter((c) => c.kind === "fraud_attempt");
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[14px] text-slate">{company.legalName} · GSTIN {company.gstin}</p>
        <h1 className="text-[26px] font-bold leading-8 text-navy">AI pays your vendors. Only a receipt it cannot fake lets money leave.</h1>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="In the account" value={inr(st.balance)} sub={`Opening ${inr(company.openingBalance)}`} />
        <Stat label="Vendors paid" value={inr(m.paidAmount)} sub={`${m.paid} invoices · ${m.paidByAgentsOnly} by agents alone`} />
        <Stat label="Stopped before it left" value={inr(m.stoppedAmount)} sub={`${m.stoppedCount} stopped · ${m.fraudCases} fraud case`} tone="green" />
        <Stat label="Paid without a passing receipt" value={`₹0`} sub={`${m.payoutsWithoutPassingReceipt} payouts. Always.`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card title="How a payout is released">
          <ol className="@container">
            {[
              { t: "Invoice email", d: "Untrusted. Read as data, never obeyed", Icon: Inbox },
              { t: "Payables agent", d: "Plans the payout to the account on file", Icon: Bot },
              { t: "Compliance agent", d: "GSTIN, three-way match, duplicates, TDS", Icon: Bot },
              { t: "Risk agent", d: "Email flags, new accounts, unusual amounts", Icon: Bot },
              { t: "People", d: "Checker from ₹50,000, CFO from ₹5 lakh", Icon: Building2 },
              { t: "Treasury guard", d: "Checks every signature and rule, fails closed", Icon: ShieldCheck },
              { t: "Bank", d: "Idempotent payout, status checked, never resent", Icon: Landmark },
            ].map((s, i) => (
              <li key={s.t} className="relative flex gap-3 pb-3 last:pb-0">
                {i < 6 && <span aria-hidden className="absolute bottom-0 left-[15px] top-8 w-px bg-line" />}
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line bg-white text-navy"><s.Icon size={16} aria-hidden /></span>
                <div className="min-w-0 flex-1 pt-[5px] @min-[460px]:flex @min-[460px]:gap-3">
                  <div className="text-[14px] font-semibold leading-5 @min-[460px]:w-[150px] @min-[460px]:shrink-0"><span className="tnum mr-1.5 text-mist">{i + 1}</span>{s.t}</div>
                  <div className="text-[13px] leading-5 text-slate">{s.d}</div>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[13.5px] text-slate">Each agent signs with its own key. The guard holds only public keys, so it can check a signature but never make one. Taking over one agent, or all three, still cannot send money to an account that is not on file.</p>
        </Card>
        <Card title="Today's limits" right={<Pill tone="navy">Policy v{st.policy.version}</Pill>}>
          <Limit label="Paid today" value={st.spentByDay.get(day) ?? 0} max={st.policy.dailyLimit} />
          <Limit label="Paid by agents alone" value={st.agentOnlyByDay.get(day) ?? 0} max={st.policy.agentOnlyDailyCap} note="The most that can leave today if every agent were compromised" />
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px]">
            <dt className="text-slate">Checker from</dt><dd className="text-right font-semibold">{inr(st.policy.checkerFrom)}</dd>
            <dt className="text-slate">CFO from</dt><dd className="text-right font-semibold">{inr(st.policy.cfoFrom)}</dd>
            <dt className="text-slate">New account cooling</dt><dd className="text-right font-semibold">{st.policy.coolingHoursNew} hours</dd>
            <dt className="text-slate">Changed account cooling</dt><dd className="text-right font-semibold">{st.policy.coolingHoursChanged} hours</dd>
            <dt className="text-slate">Release window</dt><dd className="text-right font-semibold">9 AM to 7 PM</dd>
            <dt className="text-slate">Policy hash</dt><dd className="text-right"><Hash value={st.policyHashActive} /></dd>
          </dl>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card title="Activity" right={<button onClick={() => go("ledger")} className="text-[14px] font-semibold text-navy underline">Full ledger</button>}>
          {recent.length === 0 ? <p className="text-[14px] text-slate">Nothing yet. Press Next to start the day.</p> : (
            <ul className="divide-y divide-line">
              {recent.map((e) => (
                <li key={e.seq} className="flex gap-3 py-2 text-[14px]">
                  <span className="tnum w-[64px] shrink-0 text-slate">{timeIST(e.at)}</span>
                  <span className="flex-1">{describe(t, e)}</span>
                  <Rule id={e.ruleId} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Needs attention">
            <ul className="space-y-2 text-[14px]">
              <Attention n={m.awaitingApproval} text="payouts waiting for a person" go={() => go("approvals")} />
              <Attention n={[...st.changeRequests.values()].filter((c) => c.status === "open").length} text="bank changes to verify" go={() => go("bank")} />
              <Attention n={m.held} text="invoices held" go={() => go("payables")} />
              <Attention n={fraud.length} text="fraud attempts stopped" go={() => go("bank")} tone="green" />
              {msme.map((e) => <li key={e.seq} className="flex items-center gap-2 text-amber"><TriangleAlert size={15} aria-hidden />{describe(t, e)}</li>)}
            </ul>
          </Card>
          <Card title="Ledger integrity">
            <p className="text-[14px]">{chain.ok ? <Pill tone="green">Chain intact</Pill> : <Pill tone="red">Broken at {chain.brokenAt}</Pill>} <span className="ml-2 text-slate">{t.events.length} events, head <Hash value={t.head} /></span></p>
            <p className="mt-2 text-[13px] text-slate">Each event commits to the one before it. The head is anchored at the end of every day.</p>
          </Card>
          <Simulation t={t} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "green" }) {
  return (
    <div className="rounded-[16px] border border-line bg-surface p-4">
      <div className="text-[13.5px] text-slate">{label}</div>
      <div className={`tnum mt-1 text-[24px] font-bold leading-7 ${tone === "green" ? "text-green" : "text-navy"}`}>{value}</div>
      <div className="mt-1 text-[13px] text-slate">{sub}</div>
    </div>
  );
}

function Limit({ label, value, max, note }: { label: string; value: number; max: number; note?: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-[14px]"><span>{label}</span><span><Money paise={value} /> <span className="text-slate">of {inr(max)}</span></span></div>
      <Bar value={value} max={max} tone={value / max > 0.9 ? "amber" : "navy"} />
      {note && <p className="mt-1 text-[12.5px] text-slate">{note}</p>}
    </div>
  );
}

function Attention({ n, text, go, tone }: { n: number; text: string; go: () => void; tone?: "green" }) {
  return (
    <li className="flex items-center justify-between">
      <span><b className={`tnum ${tone === "green" ? "text-green" : n ? "text-amber" : "text-slate"}`}>{n}</b> {text}</span>
      {n > 0 && <button onClick={go} className="text-[13.5px] font-semibold text-navy underline">Open</button>}
    </li>
  );
}

function Simulation({ t }: { t: Treasury }) {
  const takeover = useB2B((s) => s.takeover);
  const autoplay = useB2B((s) => s.doc.autoplay);
  const setAutoplay = useB2B((s) => s.setAutoplay);
  const c = t.compromised;
  const toggle = (k: keyof typeof c) => takeover(t.companyId, { ...c, [k]: !c[k] });
  return (
    <Card title="Try to break it">
      <p className="text-[13.5px] text-slate">Take over an agent from now on. A taken-over agent signs whatever it is shown, including the bank details in a phishing email. Watch the others and the guard.</p>
      <div className="mt-3 space-y-2">
        {(["proposer", "compliance", "risk"] as const).map((k) => (
          <label key={k} className="flex items-center justify-between text-[14px]">
            <span>{k === "proposer" ? "Payables agent" : k === "compliance" ? "Compliance agent" : "Risk agent"}</span>
            <button role="switch" aria-checked={c[k]} onClick={() => toggle(k)} className={`relative h-6 w-10 rounded-full ${c[k] ? "bg-red" : "bg-line-strong"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${c[k] ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </label>
        ))}
        <label className="flex items-center justify-between border-t border-line pt-2 text-[14px]">
          <span>Team acts on its own (approval rounds, callbacks)<span className="block text-[12.5px] text-slate">Turning this off replays the story from the start</span></span>
          <button role="switch" aria-checked={autoplay} onClick={() => setAutoplay(!autoplay)} className={`relative h-6 w-10 shrink-0 rounded-full ${autoplay ? "bg-navy" : "bg-line-strong"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${autoplay ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </label>
      </div>
    </Card>
  );
}

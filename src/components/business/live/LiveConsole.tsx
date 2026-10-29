"use client";
// Pakka for Business, live: /business/live. A real company: people sign in and sign every action with passkeys,
// external AI agents work through the API with their own keys, and the ledger is stored on the server. Money is
// the only simulated thing (a sandbox bank).
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, FileCheck, FileText, Swords, Gavel, KeyRound, Landmark, LayoutDashboard, Link2, ListChecks, LogOut, ShieldCheck, Snowflake, Users } from "lucide-react";
import { verifyChain } from "@/b2b/ledger";
import { b2bMetrics } from "@/b2b/metrics";
import type { Treasury } from "@/b2b/treasury";
import { describe } from "@/lib/b2b/describe";
import { createCompany, signIn, useLive } from "@/lib/b2b/live-client";
import { inr, timeIST } from "@/lib/format";
import { PakkaSeal } from "@/components/shared";
import { LedgerPage, PayablesPage } from "../BusinessPages";
import { Card, Hash, Pill, Rule } from "../ui";
import { AgentApiPage, LiveApprovals, LiveAudit, LiveBanks, LivePeople, LivePolicy, LiveRedTeam, SetupPage } from "./LivePages";

type Page = "setup" | "overview" | "payables" | "approvals" | "banks" | "people" | "policy" | "ledger" | "audit" | "redteam" | "api";
const NAV: { id: Page; label: string; Icon: typeof Users }[] = [
  { id: "setup", label: "Setup", Icon: ListChecks },
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "payables", label: "Payables", Icon: FileText },
  { id: "approvals", label: "Approvals", Icon: Gavel },
  { id: "banks", label: "Vendors and banks", Icon: Landmark },
  { id: "people", label: "People and agents", Icon: Users },
  { id: "policy", label: "Policy and keys", Icon: ShieldCheck },
  { id: "ledger", label: "Ledger", Icon: Link2 },
  { id: "audit", label: "Audit export", Icon: FileCheck },
  { id: "redteam", label: "Red team", Icon: Swords },
  { id: "api", label: "Agent API", Icon: Bot },
];

export default function LiveConsole() {
  const { status, me, t, init } = useLive();
  useLive((s) => s.version);
  const [page, setPage] = useState<Page | null>(null);
  useEffect(() => { void init(); }, [init]);
  if (status === "loading") return <div className="p-8 text-slate">Loading</div>;
  if (status === "signed_out" || !me || !t) return <Welcome onDone={() => void init()} />;
  const current: Page = page ?? (t.state.sealed ? "overview" : "setup");
  const mine = [...t.state.intents.values()].filter((it) => it.status === "awaiting_approval" && it.needs.some((r) => me.person.roles.includes(r) && !it.approvals.some((a) => a.role === r))).length;
  const openBanks = [...t.state.changeRequests.values()].filter((c) => c.status === "open").length;
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-[60px] max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-8">
          <Link href="/" className="flex items-center gap-2"><PakkaSeal /><span className="text-[14px] font-semibold text-slate">for Business</span></Link>
          <Pill tone="green">Live</Pill>
          <span className="text-[14px] font-semibold text-ink">{me.company.brand}</span>
          {!t.state.sealed && <Pill tone="amber">Setup not sealed: no payouts yet</Pill>}
          {t.state.frozen.on && <Pill tone="red">Payouts frozen</Pill>}
          <div className="ml-auto flex items-center gap-3 text-[13.5px]">
            <Link href="/business" className="font-semibold text-slate underline">Open the simulation</Link>
            <span className="text-slate">{me.person.name}, {me.person.roles.join(" and ")}</span>
            <button onClick={() => void useLive.getState().signOut()} className="flex items-center gap-1 font-semibold text-navy"><LogOut size={14} aria-hidden />Sign out</button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1400px]">
        <nav className="sticky top-[60px] hidden h-[calc(100vh-60px)] w-[232px] shrink-0 border-r border-line bg-surface lg:block">
          <div className="border-b border-line p-4"><div className="text-[15px] font-semibold leading-5">{me.company.legalName}</div><div className="text-[12.5px] text-slate">GSTIN {me.company.gstin}</div></div>
          <ul className="py-2">
            {NAV.filter((n) => n.id !== "setup" || !t.state.sealed).map(({ id, label, Icon }) => (
              <li key={id}>
                <button onClick={() => setPage(id)} className={`flex h-10 w-full items-center gap-3 border-l-[3px] px-4 text-[15px] ${current === id ? "border-cyan bg-cyan-wash font-semibold text-navy" : "border-transparent font-medium text-slate hover:text-ink"}`}>
                  <Icon size={17} aria-hidden />{label}
                  {id === "approvals" && mine > 0 && <span className="ml-auto rounded-full bg-amber-wash px-2 text-[12px] font-semibold text-amber">{mine}</span>}
                  {id === "banks" && openBanks > 0 && <span className="ml-auto rounded-full bg-amber-wash px-2 text-[12px] font-semibold text-amber">{openBanks}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 px-4 pb-10 pt-5 sm:px-8">
          <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
            {NAV.map(({ id, label }) => <button key={id} onClick={() => setPage(id)} className={`h-8 shrink-0 rounded-full px-3 text-[13.5px] font-semibold ${current === id ? "bg-navy text-white" : "border border-line bg-surface text-slate"}`}>{label}</button>)}
          </div>
          {current === "setup" && <SetupPage t={t} go={(p) => setPage(p as Page)} />}
          {current === "overview" && <LiveOverview t={t} />}
          {current === "payables" && <PayablesPage t={t} at={useLive.getState().now()} />}
          {current === "approvals" && <LiveApprovals t={t} />}
          {current === "banks" && <LiveBanks t={t} />}
          {current === "people" && <LivePeople t={t} />}
          {current === "policy" && <LivePolicy t={t} />}
          {current === "ledger" && <LedgerPage t={t} />}
          {current === "api" && <AgentApiPage t={t} />}
          {current === "audit" && <LiveAudit t={t} />}
          {current === "redteam" && <LiveRedTeam t={t} />}
        </main>
      </div>
    </div>
  );
}

function LiveOverview({ t }: { t: Treasury }) {
  const m = b2bMetrics(t);
  const st = t.state;
  const day = t.dayKey(useLive.getState().now());
  const chain = verifyChain(t.events);
  const recent = t.events.filter((e) => !["attested", "step_up"].includes(e.type)).slice(-14).reverse();
  return (
    <div className="space-y-4">
      <h1 className="text-[24px] font-bold text-navy">Overview</h1>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["In the sandbox account", inr(st.balance), "Simulated money"],
          ["Vendors paid", inr(m.paidAmount), `${m.paid} invoices`],
          ["Stopped before it left", inr(m.stoppedAmount), `${m.stoppedCount} stopped`],
          ["Paid without a passing receipt", "₹0", `${m.payoutsWithoutPassingReceipt} payouts`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-[16px] border border-line bg-surface p-4"><div className="text-[13.5px] text-slate">{label}</div><div className="tnum mt-1 text-[24px] font-bold text-navy">{value}</div><div className="text-[13px] text-slate">{sub}</div></div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Activity">
          {recent.length === 0 ? <p className="text-[14px] text-slate">Nothing yet.</p> : (
            <ul className="divide-y divide-line">{recent.map((e) => <li key={e.seq} className="flex gap-3 py-2 text-[14px]"><span className="tnum w-[64px] shrink-0 text-slate">{timeIST(e.at)}</span><span className="flex-1">{describe(t, e)}</span><Rule id={e.ruleId} /></li>)}</ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Today">
            <dl className="grid grid-cols-2 gap-y-1 text-[14px]">
              <dt className="text-slate">Paid today</dt><dd className="text-right font-semibold">{inr(st.spentByDay.get(day) ?? 0)} of {inr(st.policy.dailyLimit)}</dd>
              <dt className="text-slate">By agents alone</dt><dd className="text-right font-semibold">{inr(st.agentOnlyByDay.get(day) ?? 0)} of {inr(st.policy.agentOnlyDailyCap)}</dd>
              <dt className="text-slate">Waiting for people</dt><dd className="text-right font-semibold">{m.awaitingApproval}</dd>
              <dt className="text-slate">Held</dt><dd className="text-right font-semibold">{m.held}</dd>
              <dt className="text-slate">Policy</dt><dd className="text-right">v{st.policy.version} <Hash value={st.policyHashActive} n={8} /></dd>
            </dl>
          </Card>
          <Card title="Ledger integrity">
            <p className="text-[14px]">{chain.ok ? <Pill tone="green">Chain intact</Pill> : <Pill tone="red">Broken at {chain.brokenAt}</Pill>} <span className="ml-2 text-slate">{t.events.length} events, head <Hash value={t.head} /></span></p>
            <p className="mt-2 text-[13px] text-slate">Checked in this browser from the events the server sent.</p>
          </Card>
          {st.frozen.on && <Card><p className="flex items-center gap-2 text-[14px] text-amber"><Snowflake size={16} aria-hidden />Frozen by {st.frozen.by}: {st.frozen.reason}</p></Card>}
        </div>
      </div>
    </div>
  );
}

function Welcome({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ legalName: "", brand: "", gstin: "", city: "", name: "", title: "", email: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: k === "gstin" ? e.target.value.toUpperCase() : e.target.value });
  const create = async () => {
    setBusy(true); setMsg("");
    const r = await createCompany({ legalName: form.legalName, brand: form.brand, gstin: form.gstin, city: form.city, founder: { name: form.name, title: form.title, email: form.email } });
    setBusy(false);
    if (r.ok) onDone(); else setMsg(r.error.message || r.error.code);
  };
  const login = async () => {
    setBusy(true); setMsg("");
    const r = await signIn();
    setBusy(false);
    if (r.ok) onDone(); else setMsg(r.error.code === "PASSKEY_CANCELLED" ? "Sign-in was cancelled." : r.error.code);
  };
  const field = (k: keyof typeof form, label: string, placeholder = "") => (
    <label className="block text-[14px] font-semibold">{label}<input value={form[k]} onChange={set(k)} placeholder={placeholder} className="mt-1 h-10 w-full rounded-[8px] border border-line-strong px-3 text-[14.5px] font-normal" /></label>
  );
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-white"><div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-8"><Link href="/"><PakkaSeal /></Link><span className="text-[14px] font-semibold text-slate">for Business</span><Pill tone="green">Live</Pill><Link href="/business" className="ml-auto text-[14px] font-semibold text-navy underline">Open the simulation</Link></div></header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        <h1 className="text-[30px] font-bold leading-9 text-navy">Your AI agents pay vendors. Only a receipt they cannot fake lets money leave.</h1>
        <p className="mt-3 max-w-3xl text-[16px] text-slate">This is the real system. People sign in and approve with passkeys on their own devices. Your agents connect through the API with their own keys. Every step lands in a hash-chained ledger on the server. Only the money is simulated, through a sandbox bank.</p>
        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_1.3fr]">
          <Card title="Sign in">
            <p className="text-[14px] text-slate">Use the passkey you created when you joined. Face, fingerprint or device PIN; no password.</p>
            <button disabled={busy} onClick={login} className="btn-primary mt-4 flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold"><KeyRound size={17} aria-hidden />Sign in with a passkey</button>
          </Card>
          <Card title="Create a company">
            <div className="grid gap-3 sm:grid-cols-2">
              {field("legalName", "Legal name", "Saanjh Distributors Pvt Ltd")}{field("brand", "Short name", "Saanjh")}
              {field("gstin", "GSTIN", "27AAACS1234Q1Z5")}{field("city", "City", "Pune")}
              {field("name", "Your name")}{field("title", "Your title", "Chief financial officer")}
              <div className="sm:col-span-2">{field("email", "Your work email")}</div>
            </div>
            <p className="mt-3 text-[13px] text-slate">You become the first governor. You will invite two more governors, a maker, a checker and a CFO, and register your three agents, before payouts can start.</p>
            <button disabled={busy || Object.values(form).some((v) => !v.trim())} onClick={create} className="btn-primary mt-4 h-11 rounded-full px-5 text-[15px] font-semibold">Create and register my passkey</button>
          </Card>
        </div>
        {msg && <p className="mt-4 text-[14px] font-semibold text-red" role="alert">{msg}</p>}
      </main>
    </div>
  );
}

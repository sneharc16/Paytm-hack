"use client";
// Control room, /ops (PRD 20.3): incident with Review Radar summary, case list, case file and flight recorder.
import { useEffect, useState } from "react";
import { metrics } from "@/engine/metrics";
import type { Session } from "@/engine/session";
import { inr, timeIST, dayMonth } from "@/lib/format";
import { eventsFor, recorderRow } from "@/lib/recorder";
import { sessionIdFromUrl, useSimNow, useSync } from "@/lib/sync/client";
import { PakkaSeal, RuleChip, StatusPill } from "@/components/shared";
import type { Actor } from "@/engine/types";

const ACTOR: Record<Actor, { label: string; color: string }> = {
  ai: { label: "Pakka AI", color: "var(--cyan)" }, rule: { label: "Rule", color: "var(--navy)" }, customer: { label: "Customer", color: "var(--green)" },
  merchant: { label: "Merchant", color: "var(--actor-merchant)" }, person: { label: "Person", color: "var(--actor-person)" }, system: { label: "System", color: "var(--mist)" },
};

export default function ControlRoom({ embedded = false }: { embedded?: boolean }) {
  const start = useSync((s) => s.start);
  const session = useSync((s) => s.session);
  useSync((s) => s.version);
  const now = useSimNow();
  const [subject, setSubject] = useState<{ cycleId?: string; caseCode?: string; label: string } | null>(null);
  useEffect(() => { start(sessionIdFromUrl()); }, [start]);
  if (!session) return <div className="p-8 text-slate">Loading</div>;
  const sunita = session.world.cycles.find((c) => c.group === "ask" && session.idx.mandate.get(c.mandateId)!.userId === "u_sunita")!;
  const sel = subject ?? { cycleId: sunita.id, label: "Sunita Verma, PadhoAI" };
  return (
    <main className={`@container flex flex-col ${embedded ? "h-full overflow-y-auto" : "min-h-screen"}`}>
      <Header s={session} now={now} />
      <div className="grid flex-1 gap-4 px-5 pb-6 pt-4 @min-[760px]:grid-cols-2 @min-[760px]:px-8 @min-[1200px]:grid-cols-[minmax(300px,1fr)_minmax(320px,1fr)_minmax(380px,1.3fr)]">
        <IncidentPanel s={session} now={now} />
        <CaseTable s={session} selected={sel.caseCode} onPick={(code) => {
          const cs = session.state.cases.get(code)!;
          setSubject({ caseCode: code, label: `${code}, ${session.idx.user.get(cs.userId)!.name}` });
        }} onPickSunita={() => setSubject(null)} />
        <section className="flex min-h-0 flex-col gap-4 @min-[760px]:col-span-2 @min-[1200px]:col-span-1">
          {sel.caseCode && <CaseFile s={session} code={sel.caseCode} />}
          <FlightRecorder s={session} subject={sel} />
        </section>
      </div>
    </main>
  );
}

function Header({ s, now }: { s: Session; now: string }) {
  const send = useSync((x) => x.send);
  const on = s.state.killSwitch.global;
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  return (
    <>
      {on && <div className="flex h-9 items-center justify-center bg-amber-wash text-[14px] font-semibold text-amber">Pakka actions are paused. Customer answers are being saved.</div>}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-5 py-4 @min-[760px]:px-8">
        <PakkaSeal />
        <h1 className="text-[22px] font-bold text-navy">Control room</h1>
        <span className="text-[14px] text-slate">Trust and merchant team, Priya Nair</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="tnum text-[15px] font-semibold">{timeIST(now)}, {dayMonth(now, "en")}</span>
          <div className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: on ? "var(--amber)" : "var(--green)" }} />
            <span className="text-[14px] font-semibold">{on ? "Actions paused" : "Actions live"}</span>
            {asking ? (
              <form onSubmit={(e) => { e.preventDefault(); if (reason.trim()) { void send({ kind: "kill_switch", scope: "global", on: !on, reason }); setAsking(false); setReason(""); } }} className="flex gap-1">
                <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One-line reason" className="h-8 rounded-[8px] border border-line-strong px-2 text-[14px]" />
                <button className="rounded-[8px] bg-navy px-2 text-[13px] font-semibold text-white">Confirm</button>
              </form>
            ) : (
              <button role="switch" aria-checked={on} onClick={() => setAsking(true)} className={`relative h-6 w-10 rounded-full ${on ? "bg-amber" : "bg-green"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
              </button>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

function IncidentPanel({ s, now }: { s: Session; now: string }) {
  const inc = [...s.state.incidents.values()][0];
  const m = metrics(s);
  const acted = s.state.settingsChangedBy.get("m_padhoai");
  if (!inc) return <section className="rounded-[12px] border border-line bg-surface p-5 text-[15px] text-slate">No open incidents. Review Radar is watching 14 merchants.<p className="mt-2 text-[13px]">Next run at :58, {timeIST(now)} now.</p></section>;
  const mer = s.idx.merchant.get(inc.merchantId)!;
  const mx = inc.metrics;
  return (
    <section className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-5">
      <div>
        <div className="flex items-center gap-2"><StatusPill kind="answer">{inc.id}</StatusPill><span className="text-[13px] text-slate">Opened {timeIST(inc.openedAt)}</span></div>
        <h2 className="mt-2 text-[17px] font-semibold">{mx.count} low-star reviews about {mer.brand} in 6 hours</h2>
        <p className="text-[14px] text-slate">Baseline about {Math.round(mx.baseline6h * 4)} a day. Spike threshold {mx.threshold}.</p>
      </div>
      <div className="flex flex-col gap-2">
        {([["Consent gap", mx.consent], ["Name gap", mx.name], ["Ownership gap", mx.ownership]] as const).map(([l, v]) => (
          <div key={l} className="grid grid-cols-[110px_1fr_32px] items-center gap-2 text-[14px]">
            <span>{l}</span><span className="h-2 rounded-full bg-navy-wash"><span className="block h-2 rounded-full bg-navy" style={{ width: `${(v / mx.count) * 100}%` }} /></span><b className="tnum text-right">{v}</b>
          </div>
        ))}
        <p className="text-[12px] text-slate">Tags from the hand-checked seed labels (no live model connected).</p>
      </div>
      <div>
        <h3 className="text-[15px] font-semibold">Sweep</h3>
        <dl className="mt-1 divide-y divide-line text-[14px]">
          {([["Active PadhoAI mandates", 1300], ["First charge after trial, due 27 Oct", m.sweep.dueFirst], ["Already confirmed in PadhoAI", m.sweep.confirmed], ["Need a yes from Pakka", m.sweep.needYes], ["Reminders sent", m.sweep.remindersByLang.hi + m.sweep.remindersByLang.hinglish + m.sweep.remindersByLang.en]] as const).map(([l, v]) => (
            <div key={l} className="flex justify-between py-1.5"><dt>{l}</dt><dd className="tnum font-bold">{v.toLocaleString("en-IN")}</dd></div>
          ))}
        </dl>
        <p className="mt-1 text-[13px] text-slate">Hindi {m.sweep.remindersByLang.hi}, Hinglish {m.sweep.remindersByLang.hinglish}, English {m.sweep.remindersByLang.en}</p>
      </div>
      {acted && <p className="rounded-[10px] bg-green-wash p-3 text-[14px] text-green">{acted.by} turned on &quot;Charge only after the customer says yes&quot; at {timeIST(acted.at)}.</p>}
    </section>
  );
}

const STATUS_PILL: Record<string, ["answer" | "neutral" | "done" | "muted" | "fraud", string]> = {
  with_merchant: ["neutral", "With merchant"], with_person: ["answer", "With a person"], refunded: ["done", "Refunded"], closed: ["muted", "Closed"], upheld: ["muted", "Upheld"], open: ["neutral", "Open"],
};

function CaseTable({ s, selected, onPick, onPickSunita }: { s: Session; selected?: string; onPick: (code: string) => void; onPickSunita: () => void }) {
  const cases = [...s.state.cases.values()].sort((a, b) => (a.status === "with_person" ? -1 : 0) - (b.status === "with_person" ? -1 : 0) || a.code.localeCompare(b.code));
  return (
    <section className="rounded-[12px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-[17px] font-semibold">Cases</h2>
        <button onClick={onPickSunita} className="text-[13px] font-semibold text-navy underline">Sunita&apos;s flight recorder</button>
      </div>
      {cases.length === 0 && <p className="p-5 text-[15px] text-slate">No cases waiting for a person.</p>}
      <table className="w-full text-[14px]">
        <tbody>
          {cases.map((c) => {
            const [kind, label] = c.type === "fraud" ? (["fraud", "Fraud lane"] as const) : STATUS_PILL[c.status];
            return (
              <tr key={c.code} onClick={() => onPick(c.code)} className={`cursor-pointer border-b border-line last:border-b-0 ${selected === c.code ? "bg-cyan-wash" : ""}`}>
                <td className="px-5 py-2.5"><b>{c.code}</b><div className="tnum text-slate">{inr(c.amount)}</div></td>
                <td className="py-2.5 pr-2">{s.idx.user.get(c.userId)!.name}<div className="text-slate">{c.type === "fraud" ? "Says never approved" : c.status === "with_person" ? "Merchant declined" : "Outside the auto rule"}</div></td>
                <td className="pr-5 text-right"><StatusPill kind={kind}>{label}</StatusPill></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function CaseFile({ s, code }: { s: Session; code: string }) {
  const send = useSync((x) => x.send);
  const cs = s.state.cases.get(code)!;
  const [reason, setReason] = useState("");
  const sum = cs.summary as Record<string, unknown> | undefined;
  const decide = (decision: "refund" | "uphold" | "need_info") => reason.trim() && send({ kind: "person_decision", caseId: code, decision, reason, by: "Priya Nair" });
  return (
    <div className="rounded-[12px] border border-line bg-surface p-5 text-[14px]">
      <div className="flex items-center justify-between"><h2 className="text-[17px] font-semibold">{code}</h2>{cs.type === "fraud" && <StatusPill kind="fraud">Fraud lane</StatusPill>}</div>
      {sum ? (
        <>
          <ul className="mt-2 list-disc pl-5">{(sum.summary as string[]).map((x) => <li key={x}>{x}</li>)}</ul>
          <dl className="mt-3 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-slate">Customer asked</dt><dd>{String(sum.customer_ask)}</dd>
            <dt className="text-slate">Rules said</dt><dd>{String(sum.rules_said)}</dd>
            <dt className="text-slate">Merchant position</dt><dd>{String(sum.merchant_position || cs.merchantPosition || "")}</dd>
            <dt className="text-slate">Evidence</dt><dd>{(sum.evidence as string[]).join("; ")}</dd>
          </dl>
          <div className="mt-3 rounded-[10px] bg-canvas p-3 text-slate"><b className="text-ink">Pakka&apos;s suggestion</b> ({String(sum.suggestion_confidence)}): {String(sum.suggested_next_step)}</div>
        </>
      ) : <p className="mt-2 text-slate">With {s.idx.merchant.get(cs.merchantId)!.brand} to decide.</p>}
      {cs.callback && <p className="mt-3">Callback by {timeIST(cs.callback.by)}, code <b>{cs.callback.code}</b>{cs.callback.doneAt ? `, done at ${timeIST(cs.callback.doneAt)}` : ""}.</p>}
      {cs.decision ? (
        <p className="mt-3 rounded-[10px] bg-green-wash p-3 text-green">{cs.decision.by}: {cs.decision.decision}, &quot;{cs.decision.reason}&quot;</p>
      ) : cs.status === "with_person" && (
        <div className="mt-3 flex flex-col gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One-line reason (required)" className="h-10 rounded-[8px] border border-line-strong px-3" />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => decide("refund")} className="h-10 rounded-[10px] bg-navy px-3 font-semibold text-white disabled:opacity-50" disabled={!reason.trim()}>Ask merchant to refund</button>
            <button onClick={() => decide("uphold")} className="h-10 rounded-[10px] border border-line-strong px-3 font-semibold text-navy disabled:opacity-50" disabled={!reason.trim()}>Uphold merchant decision</button>
            <button onClick={() => decide("need_info")} className="h-10 rounded-[10px] border border-line-strong px-3 font-semibold text-navy disabled:opacity-50" disabled={!reason.trim()}>Need more info</button>
            {cs.callback && !cs.callback.doneAt && <button onClick={() => send({ kind: "callback_done", caseId: code })} className="h-10 rounded-[10px] border border-line-strong px-3 font-semibold text-navy">Mark call done</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function FlightRecorder({ s, subject }: { s: Session; subject: { cycleId?: string; caseCode?: string; label: string } }) {
  const rows = eventsFor(s, subject).map((e) => recorderRow(s, e)).filter((r): r is NonNullable<typeof r> => !!r);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[12px] border border-line bg-surface">
      <div className="border-b border-line px-5 py-3">
        <h2 className="text-[17px] font-semibold">Flight recorder</h2>
        <p className="text-[13px] text-slate">{subject.label}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-slate">
          {Object.values(ACTOR).map((a) => <span key={a.label} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />{a.label}</span>)}
        </div>
      </div>
      <ol className="max-h-[560px] overflow-y-auto px-5 py-3">
        {rows.length === 0 && <li className="text-[14px] text-slate">Nothing yet. Play the clock to 9:10 PM.</li>}
        {rows.map((r, i) => (
          <li key={r.id} className="grid grid-cols-[64px_14px_1fr] gap-x-3">
            <span className="tnum pt-0.5 text-[13px] font-semibold text-slate">{timeIST(r.at).replace(/ (AM|PM)/, "")}<span className="block text-[11px] font-normal">{dayMonth(r.at, "en")}</span></span>
            <span className="relative flex justify-center">
              <span className="relative z-10 mt-1.5 h-2.5 w-2.5 rounded-full" style={{ background: ACTOR[r.actor].color }} title={ACTOR[r.actor].label} />
              {i < rows.length - 1 && <span className="absolute bottom-0 top-3 w-0.5 bg-line" />}
            </span>
            <div className="pb-3">
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="text-left text-[14.5px] font-semibold">{r.title}</button>
              {r.detail && <p className="text-[13.5px] text-slate">{r.detail}</p>}
              {r.chip && <div className="mt-1"><RuleChip id={r.chip} /></div>}
              {open === r.id && r.event.type === "risk_scored" && (
                <ul className="mt-2 rounded-[8px] bg-canvas p-2 text-[13px]">
                  {(r.event.payload.contributions as { id: string; label: string; points: number }[]).map((c) => <li key={c.id} className="flex justify-between"><span>{c.id} {c.label}</span><b className="tnum">{c.points > 0 ? "+" : ""}{c.points}</b></li>)}
                  <li className="mt-1 flex justify-between border-t border-line pt-1 font-bold"><span>Total, band {r.event.payload.band}</span><span>{r.event.payload.score}</span></li>
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

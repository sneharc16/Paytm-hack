"use client";
// Control room pages beyond the overview (PRD 20.3): O2 cases, O4 Review Radar, O5 audit and kill switches,
// and the red-team panel (PRD 29.2).
import { useMemo, useState } from "react";
import { CheckCircle2, Download, Play, XCircle } from "lucide-react";
import { ms } from "@/engine/clock";
import { radarSnapshot, tagReview } from "@/engine/radar";
import { RED_TEAM, type RedTeamResult } from "@/engine/redteam";
import { RULES } from "@/engine/rules/catalog";
import type { Session } from "@/engine/session";
import type { Gap, Review } from "@/engine/types";
import { dayMonth, inr, timeIST } from "@/lib/format";
import { useSync } from "@/lib/sync/client";
import { StatusPill } from "@/components/shared";
import { CaseFile, FlightRecorder, STATUS_PILL } from "./ControlRoom";

// ---------- O2 cases ----------
type Lane = "all" | "refund" | "person" | "fraud";
const laneOf = (c: { type: string; status: string; decision?: unknown }): Exclude<Lane, "all"> =>
  c.type === "fraud" ? "fraud" : c.status === "with_person" || c.decision ? "person" : "refund";

export function CasesPage({ s }: { s: Session }) {
  const [lane, setLane] = useState<Lane>("all");
  const [status, setStatus] = useState("all");
  const [merchant, setMerchant] = useState("all");
  const all = [...s.state.cases.values()].sort((a, b) => a.code.localeCompare(b.code));
  const rows = all.filter((c) => (lane === "all" || laneOf(c) === lane) && (status === "all" || c.status === status) && (merchant === "all" || c.merchantId === merchant));
  const [sel, setSel] = useState<string | null>(null);
  const picked = sel && s.state.cases.has(sel) ? sel : rows[0]?.code;
  const statuses = [...new Set(all.map((c) => c.status))];
  const merchants = [...new Set(all.map((c) => c.merchantId))];
  return (
    <div className="grid gap-4 @min-[1100px]:grid-cols-[1fr_1.1fr]">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <h2 className="mr-auto text-[17px] font-semibold">Cases</h2>
          <div className="flex rounded-full bg-canvas p-1 ring-1 ring-line">
            {(["all", "refund", "person", "fraud"] as Lane[]).map((l) => (
              <button key={l} onClick={() => setLane(l)} className={`press h-8 rounded-full px-3 text-[13px] font-semibold capitalize ${lane === l ? "bg-white text-blue shadow-[var(--shadow-card)]" : "text-slate"}`}>{l === "all" ? "All lanes" : l}</button>
            ))}
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-full border border-line-strong bg-white px-3 text-[13px]" aria-label="Status">
            <option value="all">Any status</option>{statuses.map((x) => <option key={x} value={x}>{STATUS_PILL[x]?.[1] ?? x}</option>)}
          </select>
          <select value={merchant} onChange={(e) => setMerchant(e.target.value)} className="h-9 rounded-full border border-line-strong bg-white px-3 text-[13px]" aria-label="Merchant">
            <option value="all">Any merchant</option>{merchants.map((x) => <option key={x} value={x}>{s.idx.merchant.get(x)!.brand}</option>)}
          </select>
        </div>
        {rows.length === 0 && <p className="p-5 text-[15px] text-slate">{all.length ? "No cases match these filters." : "No cases waiting for a person."}</p>}
        <table className="w-full text-[14px]">
          <tbody>
            {rows.map((c) => {
              const [kind, label] = c.type === "fraud" ? (["fraud", "Fraud lane"] as const) : STATUS_PILL[c.status];
              return (
                <tr key={c.code} onClick={() => setSel(c.code)} className={`cursor-pointer border-b border-line last:border-b-0 hover:bg-canvas ${picked === c.code ? "bg-sky-soft/60" : ""}`}>
                  <td className="px-4 py-3"><b>{c.code}</b><div className="tnum text-slate">{inr(c.amount)}</div></td>
                  <td className="py-3 pr-2">{s.idx.user.get(c.userId)!.name}<div className="text-slate">{s.idx.merchant.get(c.merchantId)!.brand}, {laneOf(c)} lane</div></td>
                  <td className="py-3 pr-2 text-slate">{dayMonth(c.openedAt, "en")}, {timeIST(c.openedAt)}</td>
                  <td className="pr-4 text-right"><StatusPill kind={kind}>{label}</StatusPill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {picked && (
        <section className="flex flex-col gap-4">
          <CaseFile s={s} code={picked} />
          <FlightRecorder s={s} subject={{ caseCode: picked, label: `${picked}, ${s.idx.user.get(s.state.cases.get(picked)!.userId)!.name}` }} />
        </section>
      )}
    </div>
  );
}

// ---------- O4 Review Radar ----------
const GAP_LABEL: Record<Gap, string> = { consent: "Consent gap", name: "Name gap", ownership: "Ownership gap", failed_wanted: "Wanted, failed", other: "Other" };
const GAP_TONE: Record<Gap, "answer" | "neutral" | "done" | "muted" | "fraud"> = { consent: "answer", name: "neutral", ownership: "neutral", failed_wanted: "done", other: "muted" };

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 120},${28 - (v / max) * 26}`).join(" ");
  return <svg width="120" height="30" viewBox="0 0 120 30" aria-hidden><polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

function highlight(text: string, span: string) {
  const i = span ? text.indexOf(span) : -1;
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark className="rounded bg-amber-wash px-0.5 text-ink">{span}</mark>{text.slice(i + span.length)}</>;
}

export function RadarPage({ s, now }: { s: Session; now: string }) {
  const rows = useMemo(() => radarSnapshot(s, now), [s, now.slice(0, 15)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState("m_padhoai");
  const daily = (merchantId: string) => Array.from({ length: 30 }, (_, i) => {
    const end = ms(now) - (29 - i) * 86_400_000;
    return s.world.reviews.filter((r) => r.merchantId === merchantId && r.rating <= 2 && ms(r.postedAt) <= end && ms(r.postedAt) > end - 86_400_000).length;
  });
  const lowStar = s.world.reviews.filter((r) => r.rating <= 2 && ms(r.postedAt) <= ms(now));
  const tagged = lowStar.filter((r) => r.goldGap).map((r) => ({ r, t: tagReview(r) }));
  const agree = tagged.filter(({ r, t }) => t.gap === r.goldGap).length;
  const fromModel = tagged.filter(({ t }) => t.modelVersion !== "seed-labels").length;
  const reviews: Review[] = lowStar.filter((r) => r.merchantId === picked).sort((a, b) => ms(b.postedAt) - ms(a.postedAt)).slice(0, 40);
  return (
    <div className="grid gap-4 @min-[1100px]:grid-cols-[1.2fr_1fr]">
      <section className="card overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-[17px] font-semibold">Review Radar</h2>
          <p className="text-[14px] text-slate">Low-star reviews per merchant, last 30 days. A spike opens an incident when the last 6 hours pass the threshold and most of them are consent or name gaps.</p>
        </div>
        <table className="w-full text-[14px]">
          <thead><tr className="border-b border-line text-left text-[13px] text-slate"><th className="px-4 py-2 font-medium">Merchant</th><th className="font-medium">30 days</th><th className="font-medium">Last 6 hours</th><th className="pr-4 text-right font-medium">Status</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const m = s.idx.merchant.get(r.merchantId)!;
              const incident = s.state.openIncidentFor(r.merchantId);
              return (
                <tr key={r.merchantId} onClick={() => setPicked(r.merchantId)} className={`cursor-pointer border-b border-line last:border-b-0 hover:bg-canvas ${picked === r.merchantId ? "bg-sky-soft/60" : ""}`}>
                  <td className="px-4 py-2.5 font-semibold">{m.brand}</td>
                  <td><Sparkline values={daily(r.merchantId)} /></td>
                  <td className="tnum">{r.count6h} <span className="text-slate">of {Math.ceil(r.threshold)}</span></td>
                  <td className="pr-4 text-right">{incident ? <StatusPill kind="answer">{incident.id}</StatusPill> : r.spike ? <StatusPill kind="answer">Spike</StatusPill> : <StatusPill kind="muted">Normal</StatusPill>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="flex flex-col gap-4">
        <section className="card p-4">
          <h3 className="text-[15px] font-semibold">Tagger agreement</h3>
          <p className="mt-1 text-[14px] text-slate">
            {fromModel ? `Tagged by the review model (l2-v2) on ${fromModel} reviews. ` : "No model connected: tags shown are the hand-checked seed labels. Run pnpm bake:llm with a key to tag with the model. "}
            {tagged.length} checked by hand, {tagged.length ? Math.round((agree / tagged.length) * 100) : 0}% agree.
          </p>
        </section>
        <section className="card overflow-hidden">
          <h3 className="border-b border-line p-4 text-[15px] font-semibold">{s.idx.merchant.get(picked)!.brand}: recent low-star reviews</h3>
          <ul className="max-h-[560px] divide-y divide-line overflow-y-auto">
            {reviews.length === 0 && <li className="p-4 text-[14px] text-slate">No low-star reviews yet.</li>}
            {reviews.map((r) => {
              const t = tagReview(r);
              return (
                <li key={r.id} className="p-4 text-[14px]">
                  <div className="flex items-center gap-2">
                    <StatusPill kind={GAP_TONE[t.gap]}>{GAP_LABEL[t.gap]}</StatusPill>
                    <span className="text-[12px] text-slate">{r.rating} star, {r.author}, {dayMonth(r.postedAt, "en")} {timeIST(r.postedAt)}, confidence {Math.round(t.confidence * 100)}%</span>
                  </div>
                  <p className="mt-1.5">{highlight(r.text, t.evidence)}</p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ---------- O5 audit and kill switches ----------
export function AuditPage({ s }: { s: Session }) {
  const send = useSync((x) => x.send);
  const [rule, setRule] = useState("all");
  const [actor, setActor] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [reason, setReason] = useState("");
  const raw = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("raw") === "1";
  const rows = useMemo(() => s.events.filter((e) => e.type === "action_planned").map((e) => {
    const a = s.state.actions.get(e.payload.key);
    return { id: e.payload.actionId as string, at: e.simAt, actor: e.actor, type: e.payload.actionType as string, ruleId: e.ruleId ?? "", outcome: a?.status ?? "planned", reason: a?.reason ?? "", subject: e.subjectId ?? "" };
  }), [s, s.events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = rows.filter((r) => (rule === "all" || r.ruleId === rule) && (actor === "all" || r.actor === actor) && (outcome === "all" || r.outcome === outcome)).reverse();
  const csv = () => {
    const head = "action_id,sim_time_utc,actor,tool,rule_id,outcome,reason,subject";
    const body = filtered.map((r) => [r.id, r.at, r.actor, r.type, r.ruleId, r.outcome, r.reason, r.subject].map((x) => `"${String(x).replaceAll('"', '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob([[head, ...body].join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "pakka-audit.csv"; a.click(); URL.revokeObjectURL(url);
  };
  const toggle = (scope: string, on: boolean) => { if (reason.trim()) void send({ kind: "kill_switch", scope, on, reason }); };
  if (raw) return <pre className="card max-h-[80vh] overflow-auto p-4 text-[12px]">{JSON.stringify(s.events.slice(-200), null, 1)}</pre>;
  return (
    <div className="grid gap-4 @min-[1100px]:grid-cols-[320px_1fr]">
      <section className="card p-4">
        <h2 className="text-[17px] font-semibold">Kill switches</h2>
        <p className="mt-1 text-[14px] text-slate">Stops Pakka-initiated actions. A customer&apos;s own pause and cancel still go through.</p>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One-line reason (required)" className="mt-3 h-10 w-full rounded-full border border-line-strong px-4 text-[14px]" />
        <ul className="mt-3 divide-y divide-line">
          {[{ id: "global", brand: "All merchants" }, ...s.world.merchants].map((m) => {
            const on = m.id === "global" ? s.state.killSwitch.global : s.state.killSwitch.merchants.has(m.id);
            return (
              <li key={m.id} className="flex items-center justify-between py-2 text-[14px]">
                <span className={m.id === "global" ? "font-semibold" : ""}>{m.brand}</span>
                <button role="switch" aria-checked={on} aria-label={`Kill switch for ${m.brand}`} disabled={!reason.trim()} onClick={() => toggle(m.id, !on)}
                  className={`relative h-6 w-10 rounded-full disabled:opacity-40 ${on ? "bg-amber" : "bg-line-strong"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="card min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <h2 className="mr-auto text-[17px] font-semibold">Audit log <span className="text-[14px] font-normal text-slate">{filtered.length} actions</span></h2>
          <select value={rule} onChange={(e) => setRule(e.target.value)} className="h-9 rounded-full border border-line-strong bg-white px-3 text-[13px]" aria-label="Rule">
            <option value="all">Any rule</option>{Object.keys(RULES).map((r) => <option key={r}>{r}</option>)}
          </select>
          <select value={actor} onChange={(e) => setActor(e.target.value)} className="h-9 rounded-full border border-line-strong bg-white px-3 text-[13px]" aria-label="Actor">
            <option value="all">Any actor</option>{["ai", "rule", "customer", "merchant", "person", "system"].map((a) => <option key={a}>{a}</option>)}
          </select>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-9 rounded-full border border-line-strong bg-white px-3 text-[13px]" aria-label="Outcome">
            <option value="all">Any outcome</option>{["executed", "verified", "blocked", "failed", "planned"].map((a) => <option key={a}>{a}</option>)}
          </select>
          <button onClick={csv} className="btn-soft inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold"><Download size={15} />CSV</button>
          <a href="/ops/audit?raw=1" className="text-[13px] font-semibold text-blue">Raw events</a>
        </div>
        <div className="max-h-[620px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-white"><tr className="border-b border-line text-left text-slate"><th className="px-4 py-2 font-medium">Action</th><th className="font-medium">Time</th><th className="font-medium">Actor</th><th className="font-medium">Tool</th><th className="font-medium">Rule</th><th className="pr-4 font-medium">Outcome</th></tr></thead>
            <tbody>
              {filtered.slice(0, 300).map((r) => (
                <tr key={r.id + r.at} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2 font-semibold">{r.id}</td>
                  <td className="tnum whitespace-nowrap text-slate">{dayMonth(r.at, "en")} {timeIST(r.at)}</td>
                  <td>{r.actor}</td><td>{r.type}</td>
                  <td><span className="rounded bg-navy-wash px-1.5 py-px font-semibold text-navy">{r.ruleId}</span></td>
                  <td className="pr-4">{r.outcome}{r.reason ? `: ${r.reason}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-5 text-[14px] text-slate">No actions yet. Play the demo clock.</p>}
        </div>
      </section>
    </div>
  );
}

// ---------- Red-team panel ----------
export function RedTeamPanel() {
  const session = useSync((x) => x.session);
  const [results, setResults] = useState<Record<string, RedTeamResult | "running">>({});
  if (!session) return null;
  const runOne = (id: string) => new Promise<void>((resolve) => {
    setResults((r) => ({ ...r, [id]: "running" }));
    setTimeout(() => {
      const c = RED_TEAM.find((x) => x.id === id)!;
      let out: RedTeamResult;
      try { out = c.run(session.world); } catch (e) { out = { id, passed: false, observed: [`Error: ${(e as Error).message}`] }; }
      setResults((r) => ({ ...r, [id]: out }));
      resolve();
    }, 30);
  });
  const runAll = async () => { for (const c of RED_TEAM) await runOne(c.id); };
  const done = Object.values(results).filter((r) => r !== "running") as RedTeamResult[];
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <div className="mr-auto">
          <h2 className="text-[17px] font-semibold">Red team</h2>
          <p className="text-[14px] text-slate">Each attack runs on its own copy of the world, so the live demo is never touched.</p>
        </div>
        {done.length > 0 && <span className="text-[14px] font-semibold text-green">{done.filter((r) => r.passed).length} of {done.length} defended</span>}
        <button onClick={runAll} className="btn-primary inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold"><Play size={16} />Run all</button>
      </div>
      <ul className="divide-y divide-line">
        {RED_TEAM.map((c) => {
          const r = results[c.id];
          return (
            <li key={c.id} className="grid gap-3 p-4 @min-[900px]:grid-cols-[1fr_1fr_auto]">
              <div>
                <p className="text-[15px] font-semibold"><span className="mr-2 text-slate">{c.id}</span>{c.title}</p>
                <p className="text-[14px] text-slate">{c.steps}</p>
                <p className="mt-1 text-[13px] text-slate">Expected: {c.expected}</p>
              </div>
              <div className="text-[13px]">
                {r === "running" && <p className="text-slate">Running</p>}
                {r && r !== "running" && (
                  <div className={`rounded-[12px] p-3 ${r.passed ? "bg-green-wash" : "bg-red-wash"}`}>
                    <p className={`flex items-center gap-1.5 font-semibold ${r.passed ? "text-green" : "text-red"}`}>{r.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}{r.passed ? "Defended" : "Not as expected"}</p>
                    <ul className="mt-1 space-y-0.5 text-ink">{r.observed.map((o) => <li key={o}>{o}</li>)}</ul>
                  </div>
                )}
              </div>
              <button onClick={() => runOne(c.id)} className="btn-soft h-9 self-start rounded-full px-4 text-[13px] font-semibold">Run</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

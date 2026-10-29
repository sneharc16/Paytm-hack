"use client";
// The business console's pages: payables with the receipt inspector, approvals, bank changes, policy and keys,
// the red team and the ledger.
import { useMemo, useState } from "react";
import { Bot, Download, Fingerprint, KeyRound, Mail, Snowflake, Swords } from "lucide-react";
import { approveMessage, attestMessage, verifySig } from "@/b2b/crypto";
import { verifyChain } from "@/b2b/ledger";
import { diffPolicy, isLoosening } from "@/b2b/policy";
import { RED_TEAM_B2B, type RedTeamResult } from "@/b2b/redteam";
import { B2B_RULES } from "@/b2b/rules";
import type { IntentState, InvoiceStatus } from "@/b2b/state";
import type { Treasury } from "@/b2b/treasury";
import type { Person } from "@/b2b/types";
import { checkText, describe } from "@/lib/b2b/describe";
import { businessWorld, useB2B } from "@/lib/b2b/store";
import { inr, timeIST } from "@/lib/format";
import { whenIST } from "./BusinessConsole";
import { Card, CheckRow, Hash, Money, Pill, PinSheet, Rule, Toast, type Tone } from "./ui";

const STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  not_arrived: { label: "Not arrived", tone: "muted" }, received: { label: "Received", tone: "navy" }, held: { label: "Held", tone: "amber" },
  rejected: { label: "Rejected", tone: "red" }, proposed: { label: "Being checked", tone: "navy" }, awaiting_approval: { label: "Waiting for people", tone: "amber" },
  deferred: { label: "Waiting", tone: "navy" }, paying: { label: "With the bank", tone: "navy" }, paid: { label: "Paid", tone: "green" },
};

function useAct(t: Treasury) {
  const send = useB2B((s) => s.send);
  const [pending, setPending] = useState<{ title: string; detail: string; run: (pin: string) => ReturnType<typeof send> } | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "green" | "red" } | null>(null);
  const ui = (
    <>
      {pending && <PinSheet title={pending.title} detail={pending.detail} onCancel={() => setPending(null)} onConfirm={(pin) => {
        const r = pending.run(pin);
        setPending(null);
        setToast(r.ok ? { text: "Signed and recorded in the ledger", tone: "green" } : { text: `Refused: ${r.reason?.replace(/_/g, " ").toLowerCase()}`, tone: "red" });
      }} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </>
  );
  const direct = (cmd: Parameters<typeof send>[1]) => {
    const r = send(t.companyId, cmd);
    setToast(r.ok ? { text: "Recorded in the ledger", tone: "green" } : { text: `Refused: ${r.reason?.replace(/_/g, " ").toLowerCase()}`, tone: "red" });
  };
  return { ask: setPending, direct, send: (cmd: Parameters<typeof send>[1]) => send(t.companyId, cmd), ui };
}

// ---------------- Payables ----------------
export function PayablesPage({ t }: { t: Treasury }) {
  const [filter, setFilter] = useState<"all" | InvoiceStatus>("all");
  const [open, setOpen] = useState<string | null>(null);
  const invoices = t.world.invoices.filter((i) => i.companyId === t.companyId && t.state.invoices.get(i.id)!.status !== "not_arrived").reverse();
  const shown = invoices.filter((i) => filter === "all" || t.state.invoices.get(i.id)!.status === filter);
  const count = (s: InvoiceStatus) => invoices.filter((i) => t.state.invoices.get(i.id)!.status === s).length;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
      <Card title="Invoices" right={<span className="text-[13.5px] text-slate">{invoices.length} received</span>}>
        <div className="mb-3 flex flex-wrap gap-2">
          {(["all", "paid", "awaiting_approval", "deferred", "held", "rejected"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`h-8 rounded-full px-3 text-[13px] font-semibold ${filter === f ? "bg-navy text-white" : "border border-line text-slate"}`}>
              {f === "all" ? "All" : STATUS[f].label} {f !== "all" && <span className="tnum">({count(f)})</span>}
            </button>
          ))}
        </div>
        {shown.length === 0 ? <p className="py-6 text-center text-[14px] text-slate">No invoices here yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="text-[12.5px] text-slate"><tr><th className="py-2 font-semibold">Invoice</th><th className="font-semibold">Vendor</th><th className="text-right font-semibold">Amount</th><th className="pl-4 font-semibold">Status</th><th className="font-semibold">Rule</th></tr></thead>
              <tbody className="divide-y divide-line">
                {shown.map((i) => {
                  const s = t.state.invoices.get(i.id)!;
                  const v = t.world.vendors.find((x) => x.id === i.vendorId)!;
                  const it = s.intentHash ? t.state.intents.get(s.intentHash) : undefined;
                  return (
                    <tr key={i.id} onClick={() => setOpen(i.id)} className={`cursor-pointer hover:bg-[#F7FAFE] ${open === i.id ? "bg-cyan-wash" : ""}`}>
                      <td className="py-2"><div className="font-semibold">{i.number}</div><div className="text-[12.5px] text-slate">{timeIST(s.receivedAt ?? i.arrivesAt)}{s.flags.length > 0 && <span className="ml-2 font-semibold text-red">{s.flags.length} email flags</span>}</div></td>
                      <td>{v.brand}{v.msme && <span className="ml-1.5 text-[12px] font-semibold text-amber">MSME</span>}</td>
                      <td className="text-right"><Money paise={i.total} /></td>
                      <td className="pl-4"><Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill>{it?.tier && it.tier !== "agents" && s.status !== "paid" && <span className="ml-1 text-[12px] text-slate">{it.needs.join(", ")}</span>}</td>
                      <td><Rule id={s.ruleId ?? (it ? t.events.findLast((e) => e.payload.intentHash === it.hash && e.ruleId)?.ruleId : undefined)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open ? <ReceiptInspector t={t} invoiceId={open} onClose={() => setOpen(null)} /> : <Card title="Receipt inspector"><p className="text-[14px] text-slate">Pick an invoice to see its email, the plan the agents signed, every signature and every check the guard ran.</p></Card>}
    </div>
  );
}

function ReceiptInspector({ t, invoiceId, onClose }: { t: Treasury; invoiceId: string; onClose: () => void }) {
  const at = useB2B((s) => s.doc.at);
  const inv = t.world.invoices.find((i) => i.id === invoiceId)!;
  const v = t.world.vendors.find((x) => x.id === inv.vendorId)!;
  const s = t.state.invoices.get(invoiceId)!;
  const intents = [...t.state.intents.values()].filter((x) => x.intent.invoiceIds.includes(invoiceId));
  const it = intents.at(-1);
  const [recheck, setRecheck] = useState<ReturnType<Treasury["check"]> | null>(null);
  const evidence = t.events.find((e) => e.type === "invoice_received" && e.payload.invoiceId === invoiceId)?.payload.evidence as string[] | undefined;
  return (
    <Card title={`${inv.number}, ${v.brand}`} right={<button onClick={onClose} className="text-[13.5px] font-semibold text-navy underline">Close</button>} className="self-start xl:sticky xl:top-[80px] xl:max-h-[calc(100vh-96px)] xl:overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2"><Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill>{s.utr && <span className="text-[13px] text-slate">UTR <span className="font-mono">{s.utr}</span></span>}</div>
      {s.reasons.length > 0 && <p className="mt-2 text-[14px] text-amber">{s.reasons.join("; ")}</p>}
      <h3 className="mt-4 flex items-center gap-2 text-[14.5px] font-semibold"><Mail size={15} aria-hidden />The email, read as data</h3>
      <div className="mt-1 rounded-[10px] border border-line bg-[#FBFCFE] p-3 text-[13.5px]">
        <div className="text-slate">From {inv.email.from}</div>
        <div className="font-semibold">{inv.email.subject}</div>
        <p className="mt-1 whitespace-pre-wrap">{inv.email.body}</p>
      </div>
      {evidence && evidence.length > 0 && <ul className="mt-2 space-y-1 text-[13px] text-red">{evidence.map((x) => <li key={x}>{x}</li>)}</ul>}
      <h3 className="mt-4 text-[14.5px] font-semibold">From the e-invoice and the vendor master</h3>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 text-[13.5px]">
        <dt className="text-slate">GSTIN on invoice</dt><dd className={inv.gstin === v.gstin ? "" : "font-semibold text-red"}>{inv.gstin}</dd>
        <dt className="text-slate">Order and receipt</dt><dd>{inv.poId}</dd>
        <dt className="text-slate">Taxable plus GST</dt><dd>{inr(inv.taxable)} plus {inr(inv.gst)}</dd>
        <dt className="text-slate">Total</dt><dd className="font-semibold">{inr(inv.total)}</dd>
      </dl>
      {it ? <IntentView t={t} it={it} /> : <p className="mt-4 text-[14px] text-slate">No payout was planned for this invoice.</p>}
      {intents.length > 1 && <p className="mt-2 text-[13px] text-slate">Earlier plans for this invoice: {intents.slice(0, -1).map((x) => `nonce ${x.intent.nonce} ${x.status}`).join(", ")}</p>}
      {it && (
        <div className="mt-4">
          <button onClick={() => setRecheck(t.check(it.hash, at))} className="btn-soft h-9 rounded-full px-4 text-[14px] font-semibold">Check this receipt again now</button>
          {recheck && <p className="mt-2 text-[14px]">Guard says <b>{recheck.outcome === "release" ? "release" : recheck.outcome === "defer" ? "wait" : recheck.outcome === "needs_approval" ? "needs people" : "block"}</b>{recheck.code && <>: {checkText(recheck.code)}</>}. {recheck.code === "NOT_REPLAYED" && "It was already paid, so it can never be paid again."}</p>}
        </div>
      )}
    </Card>
  );
}

function IntentView({ t, it }: { t: Treasury; it: IntentState }) {
  const i = it.intent;
  const ben = t.state.beneficiaries.get(i.beneficiaryId);
  const agents = t.world.agents;
  return (
    <>
      <h3 className="mt-4 flex items-center gap-2 text-[14.5px] font-semibold"><Fingerprint size={15} aria-hidden />The signed plan</h3>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 text-[13.5px]">
        <dt className="text-slate">Pays</dt><dd className="font-semibold">{inr(i.amount)} after TDS {inr(i.tds)}</dd>
        <dt className="text-slate">To</dt><dd>{ben ? `${ben.nameAtBank}, account ending ${ben.accountNo.slice(-4)}` : "Unknown"}{ben && ben.accountHash !== i.accountHash && <span className="block font-semibold text-red">Not the account on file</span>}</dd>
        <dt className="text-slate">Rail and nonce</dt><dd>{i.rail}, nonce {i.nonce}</dd>
        <dt className="text-slate">Policy</dt><dd>v{i.policyVersion} <Hash value={i.policyHash} n={8} /></dd>
        <dt className="text-slate">Valid until</dt><dd>{whenIST(i.expiresAt)}</dd>
        <dt className="text-slate">Intent hash</dt><dd><Hash value={it.hash} n={16} /></dd>
      </dl>
      <h3 className="mt-4 text-[14.5px] font-semibold">Signatures, checked here in your browser</h3>
      <ul className="mt-1">
        {it.attestations.map((a, n) => {
          const ag = agents.find((x) => x.id === a.signerId);
          const ok = !!ag && verifySig(ag.publicKey, attestMessage(a), a.sig);
          return <CheckRow key={n} ok={ok && a.verdict !== "reject"} label={`${ag?.name ?? a.signerId}: ${a.verdict}`} detail={`${a.reasons.join(", ")}${ok ? "" : ". Signature does not verify"}`} />;
        })}
        {it.approvals.map((a, n) => {
          const p = t.world.people.find((x) => x.id === a.personId);
          const ok = !!p && verifySig(p.publicKey, approveMessage(a), a.sig);
          return <CheckRow key={`p${n}`} ok={ok} label={`${p?.name ?? a.personId} as ${a.role}`} detail={`Signed ${timeIST(a.at)} on their own device key`} />;
        })}
        {it.status === "awaiting_approval" && it.needs.filter((r) => !it.approvals.some((a) => a.role === r)).map((r) => <li key={r} className="py-1 text-[14px] text-amber">Waiting for the {r}: {it.needReasons.join("; ")}</li>)}
      </ul>
      {it.checks && (
        <>
          <h3 className="mt-4 text-[14.5px] font-semibold">What the guard checked</h3>
          <ul className="mt-1 columns-1 sm:columns-2">{it.checks.map((c) => <CheckRow key={c.code} ok={c.ok} label={checkText(c.code)} detail={c.ok ? undefined : c.detail} />)}</ul>
        </>
      )}
    </>
  );
}

// ---------------- Approvals ----------------
export function ApprovalsPage({ t, me }: { t: Treasury; me: Person }) {
  const act = useAct(t);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const waiting = [...t.state.intents.values()].filter((it) => it.status === "awaiting_approval");
  const role = (it: IntentState) => it.needs.find((r) => me.roles.includes(r) && !it.approvals.some((a) => a.role === r) && (r === "checker" || it.approvals.some((a) => a.role === "checker")));
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Approvals</h1><p className="text-[14px] text-slate">Acting as {me.name}, {me.title}. You sign with your own key after your PIN. You cannot approve a payout you prepared or a bank account you approved.</p></div>
      {waiting.length === 0 && <Card><p className="text-[14px] text-slate">Nothing is waiting for a person right now.</p></Card>}
      {waiting.map((it) => {
        const inv = t.world.invoices.find((i) => i.id === it.intent.invoiceIds[0])!;
        const v = t.world.vendors.find((x) => x.id === it.intent.vendorId)!;
        const r = role(it);
        return (
          <Card key={it.hash}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[13.5px] text-slate">{inv.number} · {v.brand} · {it.intent.rail}</div>
                <div className="text-[22px] font-bold text-navy"><Money paise={it.intent.amount} /></div>
                <ul className="mt-1 text-[14px] text-amber">{it.needReasons.map((x) => <li key={x}>{x}</li>)}</ul>
                <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
                  {it.needs.map((n) => <Pill key={n} tone={it.approvals.some((a) => a.role === n) ? "green" : "muted"}>{n === "cfo" ? "CFO" : "Checker"}: {it.approvals.find((a) => a.role === n) ? t.world.people.find((p) => p.id === it.approvals.find((a) => a.role === n)!.personId)!.name : "waiting"}</Pill>)}
                  {it.attestations.map((a) => <Pill key={a.signerId} tone={a.verdict === "approve" ? "green" : "amber"}>{a.role}: {a.verdict}</Pill>)}
                </div>
              </div>
              {r ? (
                <div className="flex gap-2">
                  <button onClick={() => setDeclineFor(it.hash)} className="h-10 rounded-full border border-line-strong px-4 text-[14.5px] font-semibold text-navy">Decline</button>
                  <button onClick={() => act.ask({ title: `Approve ${inr(it.intent.amount)} to ${v.brand}`, detail: `You are signing as ${r === "cfo" ? "CFO" : "checker"}. The guard still runs every check before money moves.`, run: (pin) => act.send({ kind: "approve", intentHash: it.hash, personId: me.id, role: r, pin }) })} className="btn-primary h-10 rounded-full px-4 text-[14.5px] font-semibold">Approve</button>
                </div>
              ) : <span className="text-[13.5px] text-slate">{it.needs.includes("cfo") && !it.approvals.some((a) => a.role === "checker") && me.roles.includes("cfo") ? "The checker signs first" : "Not yours to sign"}</span>}
            </div>
            {declineFor === it.hash && (
              <div className="mt-3 flex gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why decline" className="h-10 flex-1 rounded-[8px] border border-line-strong px-3 text-[14px]" />
                <button disabled={reason.trim().length < 3} onClick={() => { act.ask({ title: "Decline this payout", detail: "The invoice goes on hold.", run: (pin) => act.send({ kind: "decline", intentHash: it.hash, personId: me.id, reason, pin }) }); setDeclineFor(null); setReason(""); }} className="btn-primary h-10 rounded-full px-4 text-[14px] font-semibold">Decline with PIN</button>
              </div>
            )}
          </Card>
        );
      })}
      {act.ui}
    </div>
  );
}

// ---------------- Bank changes ----------------
export function BankChangesPage({ t, me }: { t: Treasury; me: Person }) {
  const act = useAct(t);
  const at = useB2B((s) => s.doc.at);
  const [form, setForm] = useState({ vendorId: "", accountNo: "", ifsc: "" });
  const reqs = [...t.state.changeRequests.values()].reverse();
  const cases = [...t.state.cases.values()];
  const recent = [...t.state.beneficiaries.values()].filter((b) => new Date(at).getTime() - new Date(b.addedAt).getTime() < 7 * 86_400_000 && b.addedAt <= at);
  const vendors = t.world.vendors.filter((v) => v.companyId === t.companyId);
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Bank changes</h1><p className="text-[14px] text-slate">New bank details never come from an email. They need a penny drop whose name matches, a call to the number already on file, and a checker who did neither. Then the account cools for {t.state.policy.coolingHoursChanged} hours, and nothing is paid to the vendor while a change is open.</p></div>
      {reqs.length === 0 && <Card><p className="text-[14px] text-slate">No bank change requests yet.</p></Card>}
      {reqs.map((c) => {
        const v = t.world.vendors.find((x) => x.id === c.vendorId)!;
        const canCall = me.roles.includes("maker") && c.status === "open" && !c.callback;
        const canDecide = me.roles.includes("checker") && c.status === "open";
        return (
          <Card key={c.id} title={`${v.brand}: new account ending ${c.accountNo.slice(-4)}`} right={<Pill tone={c.status === "open" ? "amber" : c.status === "approved" ? "green" : "red"}>{c.status === "open" ? "Open" : c.status === "approved" ? "Approved" : "Rejected"}</Pill>}>
            <ul className="text-[14px]">
              <CheckRow ok={c.source !== "email"} label={c.source === "email" ? "Came in an email" : "Came from the vendor portal"} detail={c.source === "email" ? "Treated as a claim to verify, never as an instruction" : undefined} />
              <CheckRow ok={!!c.penny?.found && c.penny.score >= 80} label={c.penny ? (c.penny.found ? `Penny drop: holder ${c.penny.holder}` : "Penny drop: account not found") : "Penny drop pending"} detail={c.penny?.found ? `Name match with ${v.legalName}: ${c.penny.score}%` : undefined} />
              <CheckRow ok={c.callback?.outcome === "confirmed"} label={c.callback ? `Callback by ${t.world.people.find((p) => p.id === c.callback!.by)?.name}: ${c.callback.outcome}` : "No callback yet"} detail={c.callback ? c.callback.number : `Call ${v.phoneOnFile}, the number in the vendor master`} />
              {c.decidedBy && <CheckRow ok={c.status === "approved"} label={`Decided by ${t.world.people.find((p) => p.id === c.decidedBy)?.name ?? "rule"}`} detail={c.reason} />}
            </ul>
            {(canCall || canDecide) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {canCall && <>
                  <button onClick={() => act.direct({ kind: "callback", requestId: c.id, personId: me.id, outcome: "confirmed" })} className="h-9 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-navy">Vendor confirmed on call</button>
                  <button onClick={() => act.direct({ kind: "callback", requestId: c.id, personId: me.id, outcome: "denied" })} className="h-9 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-red">Vendor never asked</button>
                </>}
                {canDecide && <>
                  <button onClick={() => act.ask({ title: `Approve ${v.brand}'s new account`, detail: "Payouts to it wait for the cooling period. You will not be able to approve payouts to this account for 30 days.", run: (pin) => act.send({ kind: "decide_change", requestId: c.id, personId: me.id, decision: "approved", pin }) })} className="btn-primary h-9 rounded-full px-4 text-[14px] font-semibold">Approve</button>
                  <button onClick={() => act.ask({ title: "Reject this bank change", detail: "The vendor keeps the account on file.", run: (pin) => act.send({ kind: "decide_change", requestId: c.id, personId: me.id, decision: "rejected", pin }) })} className="h-9 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-navy">Reject</button>
                </>}
              </div>
            )}
          </Card>
        );
      })}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Cases">
          {cases.length === 0 ? <p className="text-[14px] text-slate">No cases.</p> : <ul className="space-y-3">{cases.map((c) => <li key={c.id} className="text-[14px]"><div className="flex items-center gap-2"><b>{c.id}</b><Pill tone={c.kind === "fraud_attempt" ? "red" : "amber"}>{c.kind === "fraud_attempt" ? "Fraud attempt" : c.kind === "mismatch" ? "Mismatch" : "Bank"}</Pill><Money paise={c.amount} /></div><p className="text-slate">{c.summary}</p></li>)}</ul>}
        </Card>
        <Card title="Accounts added this week">
          {recent.length === 0 ? <p className="text-[14px] text-slate">None.</p> : <ul className="space-y-2 text-[14px]">{recent.map((b) => {
            const h = b.addedVia === "change_request" ? t.state.policy.coolingHoursChanged : t.state.policy.coolingHoursNew;
            const from = new Date(new Date(b.addedAt).getTime() + h * 3_600_000).toISOString();
            return <li key={b.id}><b>{t.world.vendors.find((v) => v.id === b.vendorId)!.brand}</b>, ending {b.accountNo.slice(-4)} <span className="text-slate">· {b.status} · usable from {whenIST(from)}</span></li>;
          })}</ul>}
        </Card>
      </div>
      <Card title="Record new bank details sent by a vendor">
        <p className="mb-3 text-[13.5px] text-slate">Try it: any account opens a request. Only one whose holder name matches the vendor, confirmed on the number on file, can be approved.</p>
        <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
          <select aria-label="Vendor" value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} className="h-10 rounded-[8px] border border-line-strong bg-surface px-2 text-[14px]">
            <option value="">Vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.brand}</option>)}
          </select>
          <input aria-label="Account number" placeholder="Account number" value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value.replace(/\D/g, "") })} className="h-10 rounded-[8px] border border-line-strong px-3 text-[14px]" />
          <input aria-label="IFSC" placeholder="IFSC" value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} className="h-10 rounded-[8px] border border-line-strong px-3 text-[14px]" />
          <button disabled={!form.vendorId || form.accountNo.length < 9 || form.ifsc.length !== 11} onClick={() => { act.direct({ kind: "change_request", vendorId: form.vendorId, accountNo: form.accountNo, ifsc: form.ifsc, by: me.id }); setForm({ vendorId: "", accountNo: "", ifsc: "" }); }} className="btn-primary h-10 rounded-full px-4 text-[14px] font-semibold">Open request</button>
        </div>
      </Card>
      {act.ui}
    </div>
  );
}

// ---------------- Policy and keys ----------------
const FIELDS = [
  { k: "dailyLimit", label: "Daily limit", money: true }, { k: "agentOnlyDailyCap", label: "Agents alone, per day", money: true },
  { k: "checkerFrom", label: "Checker from", money: true }, { k: "cfoFrom", label: "CFO from", money: true },
  { k: "perTxnCap", label: "Per payout cap", money: true }, { k: "firstPaymentCap", label: "First payout to a new account", money: true },
  { k: "coolingHoursNew", label: "New account cooling, hours", money: false }, { k: "coolingHoursChanged", label: "Changed account cooling, hours", money: false },
] as const;

export function GovernancePage({ t, me }: { t: Treasury; me: Person }) {
  const act = useAct(t);
  const st = t.state;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [freezeReason, setFreezeReason] = useState("");
  const changes = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== "").map(([k, v]) => [k, FIELDS.find((f) => f.k === k)!.money ? Math.round(Number(v) * 100) : Math.round(Number(v))]));
  const next = { ...st.policy, ...changes };
  const diff = diffPolicy(st.policy, next);
  const gov = me.roles.includes("governor");
  const governors = t.world.people.filter((p) => p.companyId === t.companyId && p.roles.includes("governor"));
  const proposals = [...st.proposals.values()].reverse();
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Policy and keys</h1><p className="text-[14px] text-slate">Two of three governors change the policy. A tighter policy applies at once. A looser one waits 24 hours, and any governor can veto it in that time. Anyone with authority can freeze payouts alone; lifting a freeze needs two.</p></div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`Active policy, v${st.policy.version}`} right={<Hash value={st.policyHashActive} />}>
          <table className="w-full text-[14px]"><tbody className="divide-y divide-line">
            {FIELDS.map((f) => <tr key={f.k}><td className="py-1.5 text-slate">{f.label}</td><td className="text-right font-semibold">{f.money ? inr(st.policy[f.k]) : st.policy[f.k]}</td>
              <td className="w-[150px] pl-3">{gov && <input aria-label={`New ${f.label}`} inputMode="numeric" placeholder={f.money ? "New, in rupees" : "New"} value={draft[f.k] ?? ""} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value.replace(/[^\d]/g, "") })} className="h-8 w-full rounded-[8px] border border-line px-2 text-[13.5px]" />}</td></tr>)}
          </tbody></table>
          {gov && diff.length > 0 && (
            <div className="mt-3 rounded-[10px] bg-[#FBFCFE] p-3 text-[14px]">
              <p><b>{isLoosening(diff) ? "Looser" : "Tighter"}</b>: {isLoosening(diff) ? "after two signatures it waits 24 hours, and any governor can veto it." : "it applies as soon as two governors sign."}</p>
              <button onClick={() => act.ask({ title: `Propose policy v${st.policy.version + 1}`, detail: "Your signature counts as the first of two.", run: (pin) => act.send({ kind: "propose_policy", personId: me.id, changes, pin }) })} className="btn-primary mt-2 h-9 rounded-full px-4 text-[14px] font-semibold">Propose and sign</button>
            </div>
          )}
          {!gov && <p className="mt-3 text-[13.5px] text-slate">Act as a governor (Meera, Vikram or Sana) to propose a change.</p>}
        </Card>
        <Card title="Proposals">
          {proposals.length === 0 ? <p className="text-[14px] text-slate">None yet.</p> : <ul className="space-y-3">{proposals.map((p) => (
            <li key={p.id} className="rounded-[10px] border border-line p-3 text-[14px]">
              <div className="flex flex-wrap items-center gap-2"><b>{p.id}</b><Pill tone={p.status === "active" ? "green" : p.status === "vetoed" ? "red" : p.status === "scheduled" ? "amber" : "muted"}>{p.status === "scheduled" ? `Live at ${whenIST(p.effectiveAt!)}` : p.status}</Pill><span className="text-slate">{Object.keys(p.sigs).length} of 3 signed</span></div>
              <p className="mt-1">{p.kind === "policy" ? p.diff.map((d) => `${d.field} ${typeof d.from === "number" && d.field !== "coolingHoursNew" && d.field !== "coolingHoursChanged" ? `${inr(d.from as number)} to ${inr(d.to as number)}` : `${d.from} to ${d.to}`}`).join(", ") : p.kind === "unfreeze" ? "Lift the freeze" : `Reinstate ${p.agentId}`}</p>
              <p className="text-[13px] text-slate">Signed by {Object.keys(p.sigs).map((id) => governors.find((g) => g.id === id)?.name).join(", ")}</p>
              {gov && (p.status === "proposed" || p.status === "scheduled") && (
                <div className="mt-2 flex gap-2">
                  {p.status === "proposed" && !p.sigs[me.id] && <button onClick={() => act.ask({ title: `Sign ${p.id}`, detail: "Two signatures from different governors carry it.", run: (pin) => act.send({ kind: "sign_proposal", proposalId: p.id, personId: me.id, pin }) })} className="btn-primary h-8 rounded-full px-3 text-[13.5px] font-semibold">Sign</button>}
                  <button onClick={() => act.ask({ title: `Veto ${p.id}`, detail: "It will never take effect.", run: (pin) => act.send({ kind: "veto_proposal", proposalId: p.id, personId: me.id, pin }) })} className="h-8 rounded-full border border-line-strong px-3 text-[13.5px] font-semibold text-red">Veto</button>
                </div>
              )}
            </li>
          ))}</ul>}
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Freeze all payouts">
          {st.frozen.on ? (
            <>
              <p className="flex items-center gap-2 text-[14px] text-amber"><Snowflake size={16} aria-hidden />Frozen by {st.frozen.by} at {timeIST(st.frozen.at!)}: {st.frozen.reason}</p>
              {gov && <button onClick={() => act.ask({ title: "Propose lifting the freeze", detail: "A second governor must sign before payouts resume.", run: (pin) => act.send({ kind: "propose_unfreeze", personId: me.id, pin }) })} className="btn-primary mt-3 h-9 rounded-full px-4 text-[14px] font-semibold">Propose lifting it</button>}
            </>
          ) : (
            <div className="flex gap-2">
              <input value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} placeholder="Why" className="h-10 flex-1 rounded-[8px] border border-line-strong px-3 text-[14px]" />
              <button disabled={freezeReason.trim().length < 3} onClick={() => act.ask({ title: "Freeze all payouts", detail: "Takes effect at once. Lifting it needs two governors.", run: (pin) => act.send({ kind: "freeze", personId: me.id, reason: freezeReason, pin }) })} className="btn-primary h-10 rounded-full px-4 text-[14px] font-semibold">Freeze</button>
            </div>
          )}
        </Card>
        <Card title="Agent keys">
          <ul className="space-y-2">{t.world.agents.filter((a) => a.companyId === t.companyId).map((a) => {
            const on = st.agentStatus.get(a.id) === "active";
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 text-[14px]">
                <Bot size={16} className="text-navy" aria-hidden /><span className="min-w-[140px] font-semibold">{a.name}</span>
                <span className="text-slate">{a.modelLabel}</span><span className="flex items-center gap-1 text-slate"><KeyRound size={13} aria-hidden /><Hash value={a.publicKey} n={12} /></span>
                <Pill tone={on ? "green" : "red"}>{on ? "Active" : "Suspended"}</Pill>
                {gov && on && <button onClick={() => act.ask({ title: `Suspend ${a.name}`, detail: "Its signatures stop counting at once. Two governors must reinstate it.", run: (pin) => act.send({ kind: "suspend_agent", personId: me.id, agentId: a.id, reason: "Suspected compromise", pin }) })} className="ml-auto text-[13.5px] font-semibold text-red underline">Suspend</button>}
                {gov && !on && <button onClick={() => act.ask({ title: `Propose reinstating ${a.name}`, detail: "A second governor must sign.", run: (pin) => act.send({ kind: "propose_reinstate", personId: me.id, agentId: a.id, pin }) })} className="ml-auto text-[13.5px] font-semibold text-navy underline">Propose reinstating</button>}
              </li>
            );
          })}</ul>
        </Card>
      </div>
      <Card title="Rules">
        <ul className="grid gap-x-6 gap-y-1 text-[14px] md:grid-cols-2">{Object.entries(B2B_RULES).map(([id, text]) => <li key={id} className="flex gap-2"><Rule id={id} /><span>{text}</span></li>)}</ul>
      </Card>
      {act.ui}
    </div>
  );
}

// ---------------- Red team ----------------
export function RedTeamPage() {
  const [results, setResults] = useState<Record<string, RedTeamResult>>({});
  const [running, setRunning] = useState(false);
  const runAll = async () => {
    setRunning(true);
    setResults({});
    const w = businessWorld();
    for (const c of RED_TEAM_B2B) {
      await new Promise((r) => setTimeout(r, 0));
      let r: RedTeamResult;
      try { r = c.run(w); } catch (e) { r = { id: c.id, passed: false, observed: [`Error: ${String(e).slice(0, 160)}`], moneyMoved: false }; }
      setResults((x) => ({ ...x, [c.id]: r }));
    }
    setRunning(false);
  };
  const done = Object.values(results);
  const breaches = done.filter((r) => !r.passed).length;
  const groups = [...new Set(RED_TEAM_B2B.map((c) => c.group))];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-[24px] font-bold text-navy">Red team</h1><p className="max-w-[760px] text-[14px] text-slate">{RED_TEAM_B2B.length} attacks, each run for real against a fresh copy of the treasury in this browser. Nothing is marked defended unless the defence is observed. Tampering attacks first check that the untouched receipt passes.</p></div>
        <button disabled={running} onClick={runAll} className="btn-primary flex h-10 items-center gap-2 rounded-full px-5 text-[15px] font-semibold"><Swords size={16} aria-hidden />{running ? `Running ${done.length} of ${RED_TEAM_B2B.length}` : "Run every attack"}</button>
      </div>
      {done.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><div className="text-[13.5px] text-slate">Attacks run</div><div className="tnum text-[26px] font-bold text-navy">{done.length}</div></Card>
          <Card><div className="text-[13.5px] text-slate">Got through</div><div className={`tnum text-[26px] font-bold ${breaches ? "text-red" : "text-green"}`}>{breaches}</div></Card>
          <Card><div className="text-[13.5px] text-slate">Attack success rate, measured</div><div className={`tnum text-[26px] font-bold ${breaches ? "text-red" : "text-green"}`}>{Math.round((breaches / done.length) * 1000) / 10}%</div></Card>
        </div>
      )}
      {groups.map((g) => (
        <Card key={g} title={g}>
          <ul className="divide-y divide-line">{RED_TEAM_B2B.filter((c) => c.group === g).map((c) => {
            const r = results[c.id];
            return (
              <li key={c.id} className="grid gap-2 py-3 text-[14px] md:grid-cols-[90px_1fr_1.2fr_110px]">
                <span className="font-mono text-[13px] text-slate">{c.id}</span>
                <div><div className="font-semibold">{c.title}</div><div className="text-slate">{c.attack}</div></div>
                <div className="text-slate"><div><b className="text-ink">Expected:</b> {c.expected}</div>{r && <ul className="mt-1 text-[13px]">{r.observed.map((o, i) => <li key={i}>{o}</li>)}</ul>}</div>
                <div>{r ? <Pill tone={r.passed ? "green" : "red"}>{r.passed ? "Defended" : r.moneyMoved ? "Money moved" : "Not observed"}</Pill> : <Pill tone="muted">{running ? "Queued" : "Not run"}</Pill>}</div>
              </li>
            );
          })}</ul>
        </Card>
      ))}
    </div>
  );
}

// ---------------- Ledger ----------------
export function LedgerPage({ t }: { t: Treasury }) {
  const [q, setQ] = useState("");
  const [tamper, setTamper] = useState<string | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const rows = useMemo(() => t.events.map((e) => ({ e, text: describe(t, e) })), [t, t.events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.filter((r) => !q || `${r.text} ${r.e.type} ${r.e.ruleId ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(-300).reverse();
  const verify = () => { const r = verifyChain(t.events); setVerified(r.ok ? `Intact: ${t.events.length} events, head ${r.head.slice(0, 16)}` : `Broken at event ${r.brokenAt}: ${r.reason}`); };
  const tryTamper = () => {
    const copy = structuredClone(t.events);
    const target = copy.find((e) => e.type === "payout_submitted");
    if (!target) { setTamper("No payout yet to edit. Move the clock forward first."); return; }
    target.payload.amount = target.payload.amount * 10;
    const r = verifyChain(copy);
    setTamper(r.ok ? "Chain still intact (this should never happen)" : `Changed payout in event ${target.seq} to ${inr(target.payload.amount)} in a copy. The chain breaks at event ${r.brokenAt}: ${r.reason}.`);
  };
  const csv = () => {
    const lines = ["seq,time_utc,actor,type,rule,description,prev,hash", ...rows.map(({ e, text }) => [e.seq, e.at, e.actor, e.type, e.ruleId ?? "", `"${text.replace(/"/g, "'")}"`, e.prev, e.hash].join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `pakka-business-ledger-${t.companyId}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Ledger</h1><p className="text-[14px] text-slate">Every plan, signature, check, refusal and payout, in order. Each event carries the hash of the one before it.</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={verify} className="btn-primary h-9 rounded-full px-4 text-[14px] font-semibold">Verify the chain</button>
        <button onClick={tryTamper} className="h-9 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-navy">Try editing a past payout</button>
        <button onClick={csv} className="flex h-9 items-center gap-1 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-navy"><Download size={15} aria-hidden />Download CSV</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search the ledger" className="ml-auto h-9 w-[220px] rounded-[8px] border border-line-strong px-3 text-[14px]" />
      </div>
      {verified && <p className="text-[14px] font-semibold text-green">{verified}</p>}
      {tamper && <p className="text-[14px] font-semibold text-red">{tamper}</p>}
      <Card>
        <ul className="divide-y divide-line">{shown.map(({ e, text }) => (
          <li key={e.seq} className="grid grid-cols-[48px_74px_1fr] gap-2 py-2 text-[13.5px] md:grid-cols-[48px_74px_90px_1fr_auto_110px]">
            <span className="tnum text-mist">{e.seq}</span><span className="tnum text-slate">{timeIST(e.at)}</span>
            <span className="hidden text-slate md:block">{e.actor}</span><span>{text}</span>
            <span className="hidden md:block"><Rule id={e.ruleId} /></span><span className="hidden md:block"><Hash value={e.hash} /></span>
          </li>
        ))}</ul>
      </Card>
    </div>
  );
}

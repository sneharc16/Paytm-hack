"use client";
// Pages of the live console. Every button that changes something asks for the person's passkey, signs the exact
// action in this browser, and sends it; the server and the guard verify the signature again.
import { useState } from "react";
import { Bot, CircleCheck, CircleX, Copy, KeyRound, Snowflake } from "lucide-react";
import { EXPORT_FORMAT, exportMessage, verifyExport, type AuditReport, type LedgerExport } from "@/b2b/audit";
import { runLiveAttacks, type LiveAttackResult } from "@/b2b/liveRedteam";
import { diffPolicy, isLoosening } from "@/b2b/policy";
import type { IntentState } from "@/b2b/state";
import type { Treasury } from "@/b2b/treasury";
import { addDevice, api, useLive } from "@/lib/b2b/live-client";
import { inr, timeIST } from "@/lib/format";
import { whenIST } from "../BusinessConsole";
import { Card, CheckRow, Hash, Money, Pill, Toast } from "../ui";

function useAction() {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "green" | "red" } | null>(null);
  const run = async (cmd: Record<string, unknown> & { kind: string }, okText = "Signed with your passkey and recorded") => {
    setBusy(true);
    const r = await useLive.getState().act(cmd);
    setBusy(false);
    const missing = !r.ok && r.error.missing ? `: ${r.error.missing.join(", ")}` : "";
    setToast(r.ok ? { text: okText, tone: "green" } : { text: `${r.error.code.replace(/_/g, " ").toLowerCase()}${missing}`, tone: "red" });
    return r;
  };
  const ui = toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null;
  return { busy, run, ui, setToast };
}

const input = "h-10 w-full rounded-[8px] border border-line-strong px-3 text-[14px]";
const me = () => useLive.getState().me!;
const has = (r: string) => me().person.roles.includes(r as never);

function CopyBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <div className="text-[13px] font-semibold text-slate">{label}</div>
      <div className="mt-1 flex items-center gap-2 rounded-[8px] border border-line bg-[#FBFCFE] p-2"><code className="flex-1 break-all text-[12.5px]">{value}</code><button onClick={() => void navigator.clipboard?.writeText(value)} aria-label={`Copy ${label}`} className="text-navy"><Copy size={15} /></button></div>
    </div>
  );
}

// ---------------- setup ----------------
export function SetupPage({ t, go }: { t: Treasury; go: (p: string) => void }) {
  const a = useAction();
  const ppl = t.world.people;
  const agents = t.world.agents.filter((x) => t.state.agentStatus.get(x.id) === "active");
  const items = [
    { ok: ppl.filter((p) => p.roles.includes("governor")).length === 3, text: `Three governors (${ppl.filter((p) => p.roles.includes("governor")).length} of 3)`, go: "people" },
    { ok: ppl.some((p) => p.roles.includes("maker")), text: "A maker who runs payables", go: "people" },
    { ok: ppl.some((p) => p.roles.includes("checker")), text: "A checker", go: "people" },
    { ok: ppl.some((p) => p.roles.includes("cfo")), text: "A CFO", go: "people" },
    ...(["proposer", "compliance", "risk"] as const).map((r) => ({ ok: agents.some((x) => x.role === r), text: `A ${r === "proposer" ? "payables" : r} agent with its own key`, go: "people" })),
  ];
  const ready = items.every((i) => i.ok);
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Set up {t.world.companies[0].brand}</h1><p className="text-[14px] text-slate">No money can move until setup is sealed. After sealing, governors are fixed and any new agent needs two governors.</p></div>
      <Card title="Checklist">
        <ul>{items.map((i) => <li key={i.text} className="flex items-center gap-2 py-1.5 text-[14.5px]">{i.ok ? <CircleCheck size={17} className="text-green" aria-hidden /> : <CircleX size={17} className="text-mist" aria-hidden />}<span className={i.ok ? "" : "text-slate"}>{i.text}</span>{!i.ok && <button onClick={() => go(i.go)} className="ml-auto text-[13.5px] font-semibold text-navy underline">Do it</button>}</li>)}</ul>
        {t.state.founder === me().person.id
          ? <button disabled={!ready || a.busy} onClick={() => void a.run({ kind: "seal_org" }, "Setup sealed. Payouts can start.")} className="btn-primary mt-4 h-10 rounded-full px-5 text-[15px] font-semibold">Seal setup</button>
          : <p className="mt-3 text-[13.5px] text-slate">The founder seals setup.</p>}
      </Card>
      {t.state.founder === me().person.id && (
        <Card title="Starting rules">
          <p className="text-[13.5px] text-slate">Before sealing you can set the starting policy directly; no money can move yet. After sealing, changes need two governors and looser ones wait 24 hours. Now: new accounts cool {t.state.policy.coolingHoursNew} hours, changed accounts {t.state.policy.coolingHoursChanged} hours, payouts between {Math.floor(t.state.policy.releaseStartMin / 60)}:00 and {Math.floor(t.state.policy.releaseEndMin / 60)}:00 IST.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={a.busy} onClick={() => void a.run({ kind: "set_initial_policy", changes: { coolingHoursNew: 24, coolingHoursChanged: 72, releaseStartMin: 540, releaseEndMin: 1140 } }, "Standard rules set")} className="h-9 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-navy">Standard: 24 and 72 hour cooling, 9 AM to 7 PM</button>
            <button disabled={a.busy} onClick={() => void a.run({ kind: "set_initial_policy", changes: { coolingHoursNew: 0, coolingHoursChanged: 0, releaseStartMin: 0, releaseEndMin: 1440 } }, "Demo rules set")} className="h-9 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-navy">Demo: no cooling, any time of day</button>
          </div>
          <p className="mt-2 text-[12.5px] text-slate">Demo rules still need a checker for every first payout to an account and keep every other check.</p>
        </Card>
      )}
      <SandboxCard t={t} />
      {a.ui}
    </div>
  );
}

function SandboxCard({ t }: { t: Treasury }) {
  const a = useAction();
  const [amt, setAmt] = useState("");
  const [acct, setAcct] = useState({ accountNo: "", ifsc: "", holder: "" });
  return (
    <Card title="Sandbox bank (simulated money)">
      <p className="text-[13.5px] text-slate">Balance {inr(t.state.balance)}. The sandbox stands in for your bank: it holds test money, answers the ₹1 name check, and settles payouts with a reference number.</p>
      {(has("governor") || has("cfo")) && (
        <div className="mt-3 flex gap-2"><input inputMode="numeric" placeholder="Add rupees" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ""))} className={input} /><button disabled={!amt || a.busy} onClick={() => void a.run({ kind: "fund_sandbox", amount: Number(amt) * 100 }).then(() => setAmt(""))} className="btn-soft h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold">Add test money</button></div>
      )}
      <div className="mt-4 text-[14px] font-semibold">Open a test bank account</div>
      <p className="text-[13px] text-slate">The ₹1 name check finds only accounts that exist here. Open your vendors&apos; accounts, and a fraudster&apos;s with a different name to try the bank change defence.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
        <input placeholder="Account number" value={acct.accountNo} onChange={(e) => setAcct({ ...acct, accountNo: e.target.value.replace(/\D/g, "") })} className={input} />
        <input placeholder="IFSC" value={acct.ifsc} onChange={(e) => setAcct({ ...acct, ifsc: e.target.value.toUpperCase() })} className={input} />
        <input placeholder="Account holder name" value={acct.holder} onChange={(e) => setAcct({ ...acct, holder: e.target.value })} className={input} />
        <button disabled={a.busy || acct.accountNo.length < 9 || acct.ifsc.length !== 11 || acct.holder.length < 2} onClick={() => void a.run({ kind: "sandbox_account", ...acct }).then((r) => r.ok && setAcct({ accountNo: "", ifsc: "", holder: "" }))} className="btn-soft h-10 rounded-full px-4 text-[14px] font-semibold">Open</button>
      </div>
      {t.world.bankDirectory.length > 0 && <ul className="mt-3 text-[13px] text-slate">{t.world.bankDirectory.map((b) => <li key={b.ifsc + b.accountNo}>{b.holder}, {b.ifsc}, ending {b.accountNo.slice(-4)}</li>)}</ul>}
      {a.ui}
    </Card>
  );
}

// ---------------- people and agents ----------------
export function LivePeople({ t }: { t: Treasury }) {
  const a = useAction();
  const [inv, setInv] = useState({ name: "", title: "", email: "", roles: [] as string[] });
  const [link, setLink] = useState<string | null>(null);
  const [ag, setAg] = useState({ name: "", role: "proposer", modelLabel: "", publicKey: "" });
  const [issued, setIssued] = useState<{ apiKey: string; name: string } | null>(null);
  const gov = has("governor");
  const invite = async () => {
    const p = await api<{ inviteId: string; token: string; tokenHash: string; link: string }>("POST", "/api/v1/live/prepare", { what: "invite" });
    if (!p.ok) return a.setToast({ text: p.error.code, tone: "red" });
    const r = await a.run({ kind: "invite_person", name: inv.name, title: inv.title, email: inv.email, roles: inv.roles, inviteId: p.data.inviteId, tokenHash: p.data.tokenHash }, "Invite signed. Send the link to them.");
    if (r.ok) { setLink(p.data.link); setInv({ name: "", title: "", email: "", roles: [] }); }
  };
  const register = async () => {
    const p = await api<{ agentId: string; apiKey: string; apiKeyHash: string; apiKeyPrefix: string }>("POST", "/api/v1/live/prepare", { what: "agent" });
    if (!p.ok) return a.setToast({ text: p.error.code, tone: "red" });
    const r = await a.run({ kind: "register_agent", agentId: p.data.agentId, name: ag.name, role: ag.role, modelLabel: ag.modelLabel, publicKey: ag.publicKey.trim().toLowerCase(), apiKeyHash: p.data.apiKeyHash, apiKeyPrefix: p.data.apiKeyPrefix }, t.state.sealed ? "Proposed. A second governor must sign." : "Agent registered.");
    if (r.ok) { setIssued({ apiKey: p.data.apiKey, name: ag.name }); setAg({ name: "", role: "proposer", modelLabel: "", publicKey: "" }); }
  };
  return (
    <div className="space-y-4">
      <h1 className="text-[24px] font-bold text-navy">People and agents</h1>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="People">
          <ul className="divide-y divide-line">{t.world.people.filter((p) => !p.removedAt).map((p) => (
            <li key={p.id} className="py-2 text-[14px]">
              <div className="flex flex-wrap items-center gap-2"><b>{p.name}</b><span className="text-slate">{p.title}</span><span className="ml-auto flex gap-1">{p.roles.map((r) => <Pill key={r} tone="navy">{r}</Pill>)}</span>
                {gov && p.id !== me().person.id && !(t.state.sealed && p.roles.includes("governor")) && <button disabled={a.busy} onClick={() => void a.run({ kind: "remove_person", personId: p.id, reason: "Left the company" }, t.state.sealed ? "Proposed. A second governor must sign." : "Removed")} className="text-[12.5px] font-semibold text-red underline">Remove</button>}
              </div>
              <ul className="mt-1 text-[12.5px] text-slate">{(p.credentials ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-2"><KeyRound size={12} aria-hidden />Passkey added {whenIST(c.addedAt)} <Hash value={c.id} n={8} />
                  {(p.id === me().person.id ? (p.credentials?.length ?? 0) > 1 : gov) && <button disabled={a.busy} onClick={() => void a.run({ kind: "revoke_passkey", personId: p.id, credentialId: c.id }, "Passkey revoked")} className="font-semibold text-red underline">Revoke</button>}
                </li>
              ))}{!p.credentials?.length && <li className="text-red">No passkey: cannot sign in or approve</li>}</ul>
            </li>
          ))}</ul>
          <button onClick={() => void addDevice().then((r) => a.setToast(r.ok ? { text: "Passkey added", tone: "green" } : { text: r.error.code, tone: "red" }))} className="mt-3 text-[13.5px] font-semibold text-navy underline">Add a passkey on another device</button>
        </Card>
        <Card title="Invite someone">
          {!gov ? <p className="text-[14px] text-slate">Only governors invite people.</p> : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <input placeholder="Name" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} className={input} />
                <input placeholder="Title" value={inv.title} onChange={(e) => setInv({ ...inv, title: e.target.value })} className={input} />
                <input placeholder="Work email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} className={`${input} sm:col-span-2`} />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[14px]">{["maker", "checker", "cfo", ...(t.state.sealed ? [] : ["governor"])].map((r) => (
                <label key={r} className="flex items-center gap-1.5"><input type="checkbox" checked={inv.roles.includes(r)} onChange={(e) => setInv({ ...inv, roles: e.target.checked ? [...inv.roles, r] : inv.roles.filter((x) => x !== r) })} />{r}</label>
              ))}</div>
              <button disabled={a.busy || !inv.name || !inv.title || !inv.email.includes("@") || !inv.roles.length} onClick={() => void invite()} className="btn-primary mt-3 h-10 rounded-full px-4 text-[14px] font-semibold">Sign and create invite link</button>
              {link && <><CopyBox label="Invite link (shown once; valid 7 days, single use)" value={link} /><p className="mt-1 text-[12.5px] text-slate">The secret part after # never reaches the server log. Send it to them directly.</p></>}
              <ul className="mt-3 text-[13px] text-slate">{[...t.state.invites.values()].map((i) => <li key={i.id}>{i.name} ({i.roles.join(", ")}): {i.status}{i.status === "open" ? `, until ${whenIST(i.expiresAt)}` : ""}</li>)}</ul>
            </>
          )}
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Agents">
          {t.world.agents.length === 0 ? <p className="text-[14px] text-slate">No agents yet.</p> : (
            <ul className="divide-y divide-line">{t.world.agents.map((x) => {
              const on = t.state.agentStatus.get(x.id) === "active";
              return (
                <li key={x.id} className="py-2 text-[14px]">
                  <div className="flex flex-wrap items-center gap-2"><Bot size={15} className="text-navy" aria-hidden /><b>{x.name}</b><Pill tone="navy">{x.role}</Pill><Pill tone={on ? "green" : "red"}>{on ? "Active" : "Suspended"}</Pill>
                    {gov && on && <button onClick={() => void a.run({ kind: "suspend_agent", agentId: x.id, reason: "Suspected compromise" }, "Agent suspended")} className="ml-auto text-[13px] font-semibold text-red underline">Suspend</button>}
                    {gov && !on && <button onClick={() => void a.run({ kind: "propose_reinstate", agentId: x.id }, "Proposed. A second governor must sign.")} className="ml-auto text-[13px] font-semibold text-navy underline">Propose reinstating</button>}
                  </div>
                  <div className="text-[12.5px] text-slate">{x.modelLabel} · key <Hash value={x.publicKey} n={16} /> · API key {x.apiKeyPrefix}...{x.webhookUrl ? ` · webhook ${x.webhookUrl}` : ""}</div>
                  {gov && on && <WebhookForm agentId={x.id} current={x.webhookUrl ?? ""} run={a.run} busy={a.busy} />}
                </li>
              );
            })}</ul>
          )}
        </Card>
        <Card title="Register an agent">
          {!gov ? <p className="text-[14px] text-slate">Only governors register agents.</p> : (
            <>
              <p className="text-[13.5px] text-slate">The agent makes its own key pair and keeps the secret. Paste its public key here. Run <code>pnpm agents keygen &lt;name&gt;</code> to make one with the reference agents.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input placeholder="Name" value={ag.name} onChange={(e) => setAg({ ...ag, name: e.target.value })} className={input} />
                <select value={ag.role} onChange={(e) => setAg({ ...ag, role: e.target.value })} className={input}><option value="proposer">Payables (proposer)</option><option value="compliance">Compliance</option><option value="risk">Risk</option><option value="erp">ERP connector</option></select>
                <input placeholder="Model and version, e.g. ap-proposer-v1" value={ag.modelLabel} onChange={(e) => setAg({ ...ag, modelLabel: e.target.value })} className={`${input} sm:col-span-2`} />
                <input placeholder="Public key (64 hex characters)" value={ag.publicKey} onChange={(e) => setAg({ ...ag, publicKey: e.target.value })} className={`${input} font-mono sm:col-span-2`} />
              </div>
              <button disabled={a.busy || !ag.name || ag.modelLabel.length < 2 || !/^[0-9a-fA-F]{64}$/.test(ag.publicKey.trim())} onClick={() => void register()} className="btn-primary mt-3 h-10 rounded-full px-4 text-[14px] font-semibold">Sign and register</button>
              {issued && <>
                <CopyBox label={`API key for ${issued.name} (shown once)`} value={issued.apiKey} />
                <CopyBox label="Give it to the reference agent" value={`pnpm agents set-key <name> ${issued.apiKey} ${typeof window !== "undefined" ? window.location.origin : ""}`} />
              </>}
            </>
          )}
        </Card>
      </div>
      {a.ui}
    </div>
  );
}

function WebhookForm({ agentId, current, run, busy }: { agentId: string; current: string; run: ReturnType<typeof useAction>["run"]; busy: boolean }) {
  const [url, setUrl] = useState(current);
  return (
    <div className="mt-1 flex gap-2">
      <input placeholder="Webhook URL (https)" value={url} onChange={(e) => setUrl(e.target.value)} className="h-8 flex-1 rounded-[8px] border border-line px-2 text-[13px]" />
      <button disabled={busy || url === current} onClick={() => void run({ kind: "set_webhook", agentId, url: url.trim() || null }, url.trim() ? "Webhook set; notices are signed by this server" : "Webhook removed")} className="h-8 rounded-full border border-line-strong px-3 text-[12.5px] font-semibold text-navy">Save</button>
    </div>
  );
}

// ---------------- approvals ----------------
export function LiveApprovals({ t }: { t: Treasury }) {
  const a = useAction();
  const [why, setWhy] = useState<Record<string, string>>({});
  const waiting = [...t.state.intents.values()].filter((it) => it.status === "awaiting_approval");
  const role = (it: IntentState) => it.needs.find((r) => has(r) && !it.approvals.some((x) => x.role === r) && (r === "checker" || it.approvals.some((x) => x.role === "checker")));
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Approvals</h1><p className="text-[14px] text-slate">Your passkey signs this exact payout: payee, amount, invoice, nonce and policy. The guard checks your signature again before money moves.</p></div>
      {waiting.length === 0 && <Card><p className="text-[14px] text-slate">Nothing is waiting for a person.</p></Card>}
      {waiting.map((it) => {
        const inv = t.world.invoices.find((i) => i.id === it.intent.invoiceIds[0])!;
        const v = t.world.vendors.find((x) => x.id === it.intent.vendorId)!;
        const ben = t.state.beneficiaries.get(it.intent.beneficiaryId);
        const r = role(it);
        const v0 = t.check(it.hash, useLive.getState().now());
        const after = v0.needs.filter((n) => !it.approvals.some((x) => x.role === n) && n !== r);
        const waits = v0.checks.filter((c) => !c.ok && !["APPROVALS_COMPLETE"].includes(c.code));
        const forecast = waits.length ? `The guard will still hold it: ${waits.map((c) => c.detail ?? c.code).join("; ")}` : after.length ? `Then it waits for the ${after.join(" and ")}.` : "Money leaves as soon as you sign.";
        return (
          <Card key={it.hash}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] text-slate">{inv.number} · {v.brand} · {it.intent.rail}</div>
                <div className="text-[22px] font-bold text-navy"><Money paise={it.intent.amount} /></div>
                <ul className="mt-1 text-[14px] text-amber">{v0.needReasons.map((x) => <li key={x}>{x}</li>)}</ul>
                <details className="mt-2 rounded-[10px] border border-line bg-[#FBFCFE] p-3 text-[13.5px]" open>
                  <summary className="cursor-pointer font-semibold">What your passkey signs</summary>
                  <dl className="mt-2 grid grid-cols-[150px_1fr] gap-y-1">
                    <dt className="text-slate">Pays</dt><dd><b>{inr(it.intent.amount)}</b> after TDS {inr(it.intent.tds)} for invoice {inv.number} ({inr(inv.total)})</dd>
                    <dt className="text-slate">To</dt><dd>{ben?.nameAtBank}, {ben?.ifsc}, account ending {ben?.accountNo.slice(-4)}. The account on file, approved {ben ? whenIST(ben.addedAt) : ""}</dd>
                    <dt className="text-slate">Nonce and policy</dt><dd>nonce {it.intent.nonce}, policy v{it.intent.policyVersion}</dd>
                    <dt className="text-slate">Valid until</dt><dd>{whenIST(it.intent.expiresAt)}</dd>
                    <dt className="text-slate">Intent</dt><dd><Hash value={it.hash} n={24} /></dd>
                  </dl>
                  {r && <p className="mt-2 font-semibold text-navy">{forecast}</p>}
                </details>
                <div className="mt-2 flex flex-wrap gap-2">{it.attestations.map((x) => <Pill key={x.signerId} tone={x.verdict === "approve" ? "green" : "amber"}>{x.role}: {x.verdict}</Pill>)}{it.needs.map((n) => <Pill key={n} tone={it.approvals.some((x) => x.role === n) ? "green" : "muted"}>{n}: {it.approvals.some((x) => x.role === n) ? "signed" : "waiting"}</Pill>)}</div>
              </div>
              {r ? (
                <div className="flex flex-col items-end gap-2">
                  <button disabled={a.busy} onClick={() => void a.run({ kind: "approve", intentHash: it.hash, role: r }, "Approved with your passkey")} className="btn-primary flex h-10 items-center gap-2 rounded-full px-4 text-[14.5px] font-semibold"><KeyRound size={15} aria-hidden />Approve as {r}</button>
                  <div className="flex gap-2"><input placeholder="Reason to decline" value={why[it.hash] ?? ""} onChange={(e) => setWhy({ ...why, [it.hash]: e.target.value })} className="h-9 rounded-[8px] border border-line-strong px-2 text-[13.5px]" /><button disabled={a.busy || (why[it.hash] ?? "").trim().length < 3} onClick={() => void a.run({ kind: "decline", intentHash: it.hash, reason: why[it.hash] }, "Declined")} className="h-9 rounded-full border border-line-strong px-3 text-[13.5px] font-semibold text-navy">Decline</button></div>
                </div>
              ) : <span className="text-[13.5px] text-slate">Not yours to sign</span>}
            </div>
          </Card>
        );
      })}
      {a.ui}
    </div>
  );
}

// ---------------- vendors and banks ----------------
export function LiveBanks({ t }: { t: Treasury }) {
  const a = useAction();
  const blank = { legalName: "", brand: "", gstin: "", category: "goods", msme: false, phoneOnFile: "", email: "", termsDays: "30" };
  const [v, setV] = useState(blank);
  const [cr, setCr] = useState({ vendorId: "", accountNo: "", ifsc: "" });
  const reqs = [...t.state.changeRequests.values()].reverse();
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Vendors and banks</h1><p className="text-[14px] text-slate">Bank details come only through a request: a ₹1 name check, a call to the number on file by the maker, and approval by a checker who did neither. New accounts then cool for {t.state.policy.coolingHoursNew} hours, changed ones for {t.state.policy.coolingHoursChanged}.</p></div>
      {reqs.map((c) => {
        const vendor = t.world.vendors.find((x) => x.id === c.vendorId)!;
        return (
          <Card key={c.id} title={`${vendor.brand}: account ending ${c.accountNo.slice(-4)}`} right={<Pill tone={c.status === "open" ? "amber" : c.status === "approved" ? "green" : "red"}>{c.status}</Pill>}>
            <ul>
              <CheckRow ok={c.source !== "email"} label={c.source === "email" ? "Came in an invoice email" : "Entered by the maker"} />
              <CheckRow ok={!!c.penny?.found && c.penny.score >= 80} label={c.penny?.found ? `Name check: holder ${c.penny.holder}, ${c.penny.score}% match` : "Name check: account not found at the bank"} />
              <CheckRow ok={c.callback?.outcome === "confirmed"} label={c.callback ? `Callback: ${c.callback.outcome}` : `No callback yet. Call ${vendor.phoneOnFile}`} />
            </ul>
            {c.status === "open" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {has("maker") && !c.callback && <>
                  <button disabled={a.busy} onClick={() => void a.run({ kind: "callback", requestId: c.id, outcome: "confirmed" })} className="h-9 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-navy">Vendor confirmed on call</button>
                  <button disabled={a.busy} onClick={() => void a.run({ kind: "callback", requestId: c.id, outcome: "denied" })} className="h-9 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-red">Vendor never asked</button>
                </>}
                {has("checker") && <>
                  <button disabled={a.busy} onClick={() => void a.run({ kind: "decide_change", requestId: c.id, decision: "approved" })} className="btn-primary h-9 rounded-full px-4 text-[14px] font-semibold">Approve account</button>
                  <button disabled={a.busy} onClick={() => void a.run({ kind: "decide_change", requestId: c.id, decision: "rejected" })} className="h-9 rounded-full border border-line-strong px-4 text-[14px] font-semibold text-navy">Reject</button>
                </>}
              </div>
            )}
          </Card>
        );
      })}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Vendors">
          {t.world.vendors.length === 0 ? <p className="text-[14px] text-slate">No vendors yet.</p> : (
            <ul className="divide-y divide-line">{t.world.vendors.map((x) => {
              const b = t.state.activeBeneficiary(x.id, useLive.getState().now()) ?? [...t.state.beneficiaries.values()].find((y) => y.vendorId === x.id && y.status === "active");
              return <li key={x.id} className="py-2 text-[14px]"><b>{x.brand}</b> <span className="text-slate">{x.id} · GSTIN {x.gstin}</span><div className="text-[12.5px] text-slate">{b ? `Account ending ${b.accountNo.slice(-4)}, usable from ${whenIST(new Date(new Date(b.addedAt).getTime() + (b.addedVia === "change_request" ? t.state.policy.coolingHoursChanged : t.state.policy.coolingHoursNew) * 3_600_000).toISOString())}` : "No approved account yet"}</div></li>;
            })}</ul>
          )}
        </Card>
        <Card title="Add a vendor">
          {!has("maker") ? <p className="text-[14px] text-slate">Makers add vendors.</p> : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <input placeholder="Legal name" value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} className={input} />
                <input placeholder="Short name" value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })} className={input} />
                <input placeholder="GSTIN" value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} className={input} />
                <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} className={input}><option value="goods">Goods</option><option value="logistics">Logistics</option><option value="services">Services</option><option value="rent">Rent</option></select>
                <input placeholder="Phone on file" value={v.phoneOnFile} onChange={(e) => setV({ ...v, phoneOnFile: e.target.value })} className={input} />
                <input placeholder="Accounts email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} className={input} />
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={v.msme} onChange={(e) => setV({ ...v, msme: e.target.checked })} />MSME (paid within 45 days)</label>
                <input placeholder="Payment terms, days" value={v.termsDays} onChange={(e) => setV({ ...v, termsDays: e.target.value.replace(/\D/g, "") })} className={input} />
              </div>
              <button disabled={a.busy || !v.legalName || !v.brand || v.gstin.length !== 15 || !v.email.includes("@") || v.phoneOnFile.length < 6} onClick={() => void a.run({ kind: "add_vendor", vendor: { legalName: v.legalName, brand: v.brand, gstin: v.gstin, pan: v.gstin.slice(2, 12), category: v.category, msme: v.msme, phoneOnFile: v.phoneOnFile, email: v.email, termsDays: Number(v.termsDays || 0) } }, "Vendor added").then((r) => r.ok && setV(blank))} className="btn-primary mt-3 h-10 rounded-full px-4 text-[14px] font-semibold">Sign and add</button>
            </>
          )}
        </Card>
      </div>
      {has("maker") && t.world.vendors.length > 0 && (
        <Card title="Request a bank account for a vendor">
          <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
            <select value={cr.vendorId} onChange={(e) => setCr({ ...cr, vendorId: e.target.value })} className={input}><option value="">Vendor</option>{t.world.vendors.map((x) => <option key={x.id} value={x.id}>{x.brand}</option>)}</select>
            <input placeholder="Account number" value={cr.accountNo} onChange={(e) => setCr({ ...cr, accountNo: e.target.value.replace(/\D/g, "") })} className={input} />
            <input placeholder="IFSC" value={cr.ifsc} onChange={(e) => setCr({ ...cr, ifsc: e.target.value.toUpperCase() })} className={input} />
            <button disabled={a.busy || !cr.vendorId || cr.accountNo.length < 9 || cr.ifsc.length !== 11} onClick={() => void a.run({ kind: "change_request", ...cr }, "Request opened; the bank ran the name check").then((r) => r.ok && setCr({ vendorId: "", accountNo: "", ifsc: "" }))} className="btn-primary h-10 rounded-full px-4 text-[14px] font-semibold">Sign and open</button>
          </div>
        </Card>
      )}
      <SandboxCard t={t} />
      {a.ui}
    </div>
  );
}

// ---------------- policy and keys ----------------
const FIELDS = [
  ["dailyLimit", "Daily limit", true], ["agentOnlyDailyCap", "Agents alone, per day", true], ["checkerFrom", "Checker from", true], ["cfoFrom", "CFO from", true],
  ["perTxnCap", "Per payout cap", true], ["firstPaymentCap", "First payout to a new account", true], ["coolingHoursNew", "New account cooling, hours", false], ["coolingHoursChanged", "Changed account cooling, hours", false],
] as const;

export function LivePolicy({ t }: { t: Treasury }) {
  const a = useAction();
  const st = t.state;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const changes = Object.fromEntries(Object.entries(draft).filter(([, x]) => x !== "").map(([k, x]) => [k, FIELDS.find((f) => f[0] === k)![2] ? Number(x) * 100 : Number(x)]));
  const diff = diffPolicy(st.policy, { ...st.policy, ...changes });
  const gov = has("governor");
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Policy and keys</h1><p className="text-[14px] text-slate">Two of three governors change the policy, each with their own passkey. Looser rules wait 24 hours and any governor can veto them. One person can freeze payouts; lifting a freeze takes two.</p></div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`Active policy, v${st.policy.version}`} right={<Hash value={st.policyHashActive} />}>
          <table className="w-full text-[14px]"><tbody className="divide-y divide-line">{FIELDS.map(([k, label, money]) => (
            <tr key={k}><td className="py-1.5 text-slate">{label}</td><td className="text-right font-semibold">{money ? inr(st.policy[k]) : st.policy[k]}</td>
              <td className="w-[140px] pl-3">{gov && st.sealed && <input aria-label={`New ${label}`} inputMode="numeric" placeholder={money ? "New, rupees" : "New"} value={draft[k] ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value.replace(/\D/g, "") })} className="h-8 w-full rounded-[8px] border border-line px-2 text-[13.5px]" />}</td></tr>
          ))}</tbody></table>
          {gov && diff.length > 0 && <div className="mt-3 rounded-[10px] bg-[#FBFCFE] p-3 text-[14px]"><b>{isLoosening(diff) ? "Looser" : "Tighter"}</b>: {isLoosening(diff) ? "waits 24 hours after two signatures." : "applies at two signatures."}<br /><button disabled={a.busy} onClick={() => void a.run({ kind: "propose_policy", changes }, "Proposed and signed").then((r) => r.ok && setDraft({}))} className="btn-primary mt-2 h-9 rounded-full px-4 text-[14px] font-semibold">Propose and sign</button></div>}
        </Card>
        <Card title="Proposals">
          {st.proposals.size === 0 ? <p className="text-[14px] text-slate">None yet.</p> : <ul className="space-y-3">{[...st.proposals.values()].reverse().map((p) => (
            <li key={p.id} className="rounded-[10px] border border-line p-3 text-[14px]">
              <div className="flex flex-wrap items-center gap-2"><b>{p.id}</b><Pill tone={p.status === "active" ? "green" : p.status === "vetoed" ? "red" : p.status === "scheduled" ? "amber" : "muted"}>{p.status === "scheduled" ? `Live at ${whenIST(p.effectiveAt!)}` : p.status}</Pill><span className="text-slate">{Object.keys(p.sigs).length} of 3 signed</span></div>
              <p className="mt-1">{p.kind === "policy" ? p.diff.map((d) => `${d.field}: ${String(d.from)} to ${String(d.to)}`).join(", ") : p.kind === "unfreeze" ? "Lift the freeze" : p.kind === "reinstate" ? `Reinstate ${p.agentId}` : `Register agent ${p.agent?.name} (${p.agent?.role})`}</p>
              {gov && (p.status === "proposed" || p.status === "scheduled") && <div className="mt-2 flex gap-2">
                {p.status === "proposed" && !p.sigs[me().person.id] && <button disabled={a.busy} onClick={() => void a.run({ kind: "sign_proposal", proposalId: p.id }, "Signed")} className="btn-primary h-8 rounded-full px-3 text-[13.5px] font-semibold">Sign</button>}
                <button disabled={a.busy} onClick={() => void a.run({ kind: "veto_proposal", proposalId: p.id }, "Vetoed")} className="h-8 rounded-full border border-line-strong px-3 text-[13.5px] font-semibold text-red">Veto</button>
              </div>}
            </li>
          ))}</ul>}
        </Card>
      </div>
      <Card title="Freeze all payouts">
        {st.frozen.on ? <>
          <p className="flex items-center gap-2 text-[14px] text-amber"><Snowflake size={16} aria-hidden />Frozen by {st.frozen.by} at {timeIST(st.frozen.at!)}: {st.frozen.reason}</p>
          {gov && <button disabled={a.busy} onClick={() => void a.run({ kind: "propose_unfreeze" }, "Proposed. A second governor must sign.")} className="btn-primary mt-3 h-9 rounded-full px-4 text-[14px] font-semibold">Propose lifting it</button>}
        </> : (has("governor") || has("cfo") || has("checker")) ? (
          <div className="flex gap-2"><input placeholder="Why" value={reason} onChange={(e) => setReason(e.target.value)} className={input} /><button disabled={a.busy || reason.trim().length < 3} onClick={() => void a.run({ kind: "freeze", reason }, "All payouts frozen").then(() => setReason(""))} className="btn-primary h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold">Freeze</button></div>
        ) : <p className="text-[14px] text-slate">Checkers, the CFO and governors can freeze.</p>}
      </Card>
      {a.ui}
    </div>
  );
}

// ---------------- agent API ----------------
export function AgentApiPage({ t }: { t: Treasury }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Agent API</h1><p className="text-[14px] text-slate">Your agents call these endpoints with their API key and sign every request with their own Ed25519 key. The full reference is in docs/AGENT_API.md.</p></div>
      <Card title="Run the reference agents">
        <ol className="list-decimal space-y-1 pl-5 text-[14px]">
          <li><code>pnpm agents keygen payables</code> (and <code>compliance</code>, <code>risk</code>, <code>erp</code>). Each prints a public key.</li>
          <li>Register each under People and agents with its public key and role. Copy the API key shown once.</li>
          <li><code>pnpm agents set-key payables pk_... {origin}</code> for each.</li>
          <li><code>pnpm agents run</code> starts the three agents. They propose, check and sign as invoices arrive.</li>
          <li><code>pnpm agents erp-demo erp &lt;vendorId&gt; --gstin=&lt;GSTIN&gt;</code> pushes an order, a goods receipt and an invoice. Add <code>--phish</code> for an invoice whose email carries a prompt injection and new bank details.</li>
        </ol>
      </Card>
      <Card title="Endpoints">
        <ul className="space-y-1 font-mono text-[13px]">
          {["GET  /api/v1/agent/me", "GET  /api/v1/agent/work", "POST /api/v1/agent/commands  submit_po | submit_grn | submit_invoice | propose | attest", "GET  /api/v1/agent/intent?hash=", "GET  /api/v1/agent/events?after="].map((x) => <li key={x}>{x}</li>)}
        </ul>
        <p className="mt-3 text-[13.5px] text-slate">Headers: <code>authorization: Bearer pk_...</code>, <code>x-pakka-timestamp</code>, <code>x-pakka-nonce</code>, <code>x-pakka-signature</code> = Ed25519 over <code>PAKKA_B2B_REQUEST_V1|METHOD|path|timestamp|nonce|sha256(body)</code>. Requests older than five minutes and reused nonces are refused.</p>
        <p className="mt-2 text-[13.5px] text-slate">This company: <code>{t.companyId}</code>, policy v{t.state.policy.version}, {t.world.agents.length} agents registered.</p>
      </Card>
    </div>
  );
}

// ---------------- red team on this company's ledger ----------------
export function LiveRedTeam({ t }: { t: Treasury }) {
  const [res, setRes] = useState<LiveAttackResult[] | null>(null);
  const run = () => setRes(runLiveAttacks(t.events, useLive.getState().now(), crypto.getRandomValues(new Uint8Array(32))));
  const breaches = res?.filter((r) => r.outcome === "breach").length ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-[24px] font-bold text-navy">Red team on your ledger</h1><p className="max-w-[760px] text-[14px] text-slate">These attacks run in this browser against a private copy of {t.world.companies[0].brand}&apos;s real ledger. Nothing is sent. The attacker has the ledger and their own keys, never an agent&apos;s or a person&apos;s.</p></div>
        <button onClick={run} className="btn-primary h-10 rounded-full px-5 text-[15px] font-semibold">Run the attacks</button>
      </div>
      {res && <div className="grid gap-3 sm:grid-cols-3">
        <Card><div className="text-[13.5px] text-slate">Attacks</div><div className="tnum text-[26px] font-bold text-navy">{res.length}</div></Card>
        <Card><div className="text-[13.5px] text-slate">Got through</div><div className={`tnum text-[26px] font-bold ${breaches ? "text-red" : "text-green"}`}>{breaches}</div></Card>
        <Card><div className="text-[13.5px] text-slate">Skipped (nothing to attack yet)</div><div className="tnum text-[26px] font-bold text-navy">{res.filter((r) => r.outcome === "skipped").length}</div></Card>
      </div>}
      {res && <Card><ul className="divide-y divide-line">{res.map((r) => (
        <li key={r.id} className="grid gap-2 py-3 text-[14px] md:grid-cols-[70px_1fr_1.2fr_110px]">
          <span className="font-mono text-[13px] text-slate">{r.id}</span><div><div className="font-semibold">{r.title}</div><div className="text-slate">{r.attack}</div></div>
          <div className="text-[13px] text-slate">{r.observed}</div>
          <div><Pill tone={r.outcome === "defended" ? "green" : r.outcome === "skipped" ? "muted" : "red"}>{r.outcome === "defended" ? "Defended" : r.outcome === "skipped" ? "Skipped" : "Got through"}</Pill></div>
        </li>
      ))}</ul></Card>}
    </div>
  );
}

// ---------------- audit ----------------
export function LiveAudit({ t }: { t: Treasury }) {
  const [msg, setMsg] = useState("");
  const [report, setReport] = useState<AuditReport | null>(null);
  const download = async () => {
    setMsg("");
    const meNow = me();
    const base = { format: EXPORT_FORMAT as typeof EXPORT_FORMAT, companyId: t.companyId, head: t.head, count: t.events.length, exportedBy: meNow.person.id };
    const at = useLive.getState().now();
    try {
      const webauthn = await useLive.getState().sign(exportMessage(base, at));
      const file: LedgerExport = { ...base, exportedAt: at, events: t.events, signature: { at, webauthn } };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
      const el = document.createElement("a");
      el.href = url; el.download = `pakka-ledger-${t.companyId}-${t.events.length}.json`; el.click();
      URL.revokeObjectURL(url);
      setMsg(`Signed by you over head ${t.head.slice(0, 12)} and ${t.events.length} events.`);
    } catch (e) { setMsg(`Not signed: ${String((e as Error).message ?? e).slice(0, 120)}`); }
  };
  const verify = async (f: File | undefined) => {
    if (!f) return;
    try { setReport(verifyExport(JSON.parse(await f.text()) as LedgerExport)); } catch { setReport({ ok: false, checks: [{ name: "Readable", ok: false, detail: "Not a ledger export" }], summary: {} }); }
  };
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-bold text-navy">Audit</h1><p className="text-[14px] text-slate">Give your auditor a file they can check on their own, without trusting Pakka or you: every event, every signature, and your passkey signature over the whole thing.</p></div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Signed export">
          <p className="text-[14px] text-slate">{t.events.length} events, head <Hash value={t.head} n={16} />.</p>
          <button onClick={() => void download()} className="btn-primary mt-3 flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold"><KeyRound size={15} aria-hidden />Sign and download</button>
          {msg && <p className="mt-2 text-[13.5px] text-slate">{msg}</p>}
          <p className="mt-3 text-[13px] text-slate">Offline check: <code>pnpm b2b:verify pakka-ledger-....json</code></p>
        </Card>
        <Card title="Check an export">
          <input type="file" accept="application/json" onChange={(e) => void verify(e.target.files?.[0])} className="text-[14px]" />
          {report && <>
            <p className={`mt-3 text-[15px] font-semibold ${report.ok ? "text-green" : "text-red"}`}>{report.ok ? "Intact: every check passes" : "Does not verify"}</p>
            <ul className="mt-1">{report.checks.map((c) => <CheckRow key={c.name} ok={c.ok} label={c.name} detail={c.detail} />)}</ul>
          </>}
        </Card>
      </div>
    </div>
  );
}

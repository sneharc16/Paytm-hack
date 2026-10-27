"use client";
// Merchant console, /merchant (PRD 20.2): M1 alert and queue, M2 Pakka settings with a live checkout preview.
import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { lintOffer, PATTERN_NAMES } from "@/copy/lint";
import { metrics } from "@/engine/metrics";
import type { MerchantSettings } from "@/engine/types";
import type { Session } from "@/engine/session";
import { dayMonth, inr, timeIST } from "@/lib/format";
import { sessionIdFromUrl, useSimNow, useSync } from "@/lib/sync/client";
import { MerchantTile, PakkaSeal } from "@/components/shared";

const MID = "m_padhoai";

export default function MerchantConsole({ embedded = false }: { embedded?: boolean }) {
  const start = useSync((s) => s.start);
  const session = useSync((s) => s.session);
  useSync((s) => s.version);
  const now = useSimNow();
  const [tab, setTab] = useState<"pakka" | "refunds">("pakka");
  useEffect(() => { start(sessionIdFromUrl()); }, [start]);
  if (!session) return <div className="p-8 text-slate">Loading</div>;
  const mer = session.idx.merchant.get(MID)!;
  const waiting = [...session.state.refunds.values()].filter((r) => r.merchantId === MID && r.status === "with_merchant").length;
  const nav = ["Home", "Payments", "Subscriptions", "Pakka", "Refunds", "Settlements", "Settings"];
  return (
    <main className={`@container flex ${embedded ? "h-full" : "min-h-screen"}`}>
      <nav className="hidden w-[248px] shrink-0 border-r border-line bg-surface @min-[1100px]:block">
        <div className="flex items-center gap-3 border-b border-line p-4">
          <MerchantTile brand={mer.brand} tile={mer.tile} />
          <div><div className="text-[15px] font-semibold">{mer.brand}</div><div className="text-[13px] text-slate">{mer.legalName}</div></div>
        </div>
        <ul className="py-2">
          {nav.map((n) => {
            const active = (n === "Pakka" && tab === "pakka") || (n === "Refunds" && tab === "refunds");
            return (
              <li key={n}>
                <button onClick={() => (n === "Pakka" ? setTab("pakka") : n === "Refunds" ? setTab("refunds") : undefined)}
                  className={`flex h-10 w-full items-center justify-between border-l-[3px] px-4 text-[15px] ${active ? "border-cyan bg-cyan-wash font-semibold text-navy" : "border-transparent font-medium text-slate"}`}>
                  {n}{n === "Refunds" && waiting > 0 && <span className="rounded-full bg-amber-wash px-2 text-[12px] font-semibold text-amber">{waiting}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className={`min-w-0 flex-1 px-5 pb-8 pt-[22px] @min-[760px]:px-8 ${embedded ? "overflow-y-auto" : ""}`}>
        <div className="mb-3 flex gap-4 @min-[1100px]:hidden">
          <button onClick={() => setTab("pakka")} className="text-[14px] font-semibold text-navy underline">Pakka</button>
          <button onClick={() => setTab("refunds")} className="text-[14px] font-semibold text-navy underline">Refunds ({waiting})</button>
        </div>
        {tab === "pakka" ? <PakkaSettings s={session} now={now} /> : <RefundQueue s={session} now={now} />}
      </div>
    </main>
  );
}

function PrivateAlert({ s }: { s: Session }) {
  const alert = s.events.find((e) => e.type === "merchant_alerted" && e.payload.merchantId === MID);
  if (!alert) return null;
  return (
    <div className="mt-4 flex gap-3 rounded-[12px] bg-amber-wash p-4">
      <AlertTriangle size={20} className="shrink-0 text-amber" aria-hidden />
      <div className="flex-1 text-[15px]"><b>{alert.payload.headline}</b><p className="text-slate">{alert.payload.detail}</p></div>
      <a href="/ops" className="self-start text-[14px] font-semibold text-navy underline">See reviews</a>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-6 w-10 shrink-0 rounded-full ${on ? "bg-navy" : "bg-line-strong"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function SettingRow({ title, help, on, onChange, children }: { title: string; help: string; on: boolean; onChange: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className="border-b border-line py-3 last:border-b-0">
      <div className="flex gap-4">
        <Toggle on={on} onChange={onChange} label={title} />
        <div><div className="text-[15.5px] font-semibold">{title}</div><div className="text-[14px] text-slate">{help}</div></div>
      </div>
      {children && <div className="ml-[56px] mt-2 rounded-[8px] bg-[#FBFCFE] p-3">{children}</div>}
    </div>
  );
}

function PakkaSettings({ s, now }: { s: Session; now: string }) {
  const send = useSync((x) => x.send);
  const saved = s.settings(MID);
  const [draft, setDraft] = useState<MerchantSettings>(saved);
  const [offer, setOffer] = useState("");
  const [msg, setMsg] = useState("");
  const savedKey = JSON.stringify(saved);
  useEffect(() => { setDraft(JSON.parse(savedKey)); }, [savedKey]);
  const set = (k: Partial<MerchantSettings>) => setDraft({ ...draft, ...k });
  const issues = offer ? lintOffer(offer) : [];
  const m = metrics(s);
  const dirty = JSON.stringify(draft) !== savedKey || !!offer;
  const save = async () => {
    const r = (await send({ kind: "merchant_settings", merchantId: MID, by: "Imran Sheikh", settings: {
      askBeforeFirstCharge: draft.askBeforeFirstCharge, shareUsageSignal: draft.shareUsageSignal, offerSkip: draft.offerSkip,
      refundAuto: draft.refundAuto, refundCap: draft.refundCap, refundDailyLimit: draft.refundDailyLimit, ...(offer ? { offerCopy: { hinglish: offer } } : {}),
    } })) as { ok: boolean } | null;
    setMsg(r?.ok ? `Saved at ${timeIST(now)}` : "Fix the offer copy before saving.");
  };
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-[14px] text-slate">Subscriptions / <span className="font-semibold text-ink">Pakka</span></p><h1 className="text-[26px] font-bold leading-8 text-navy">Ask before the first real charge</h1></div>
        <div className="text-right"><button disabled={!dirty || issues.length > 0} onClick={save} className="h-10 rounded-[10px] bg-navy px-4 text-[15px] font-semibold text-white disabled:bg-line-strong disabled:text-slate">Save changes</button>{msg && <p className="mt-1 text-[13px] text-slate">{msg}</p>}</div>
      </div>
      <PrivateAlert s={s} />
      <div className="mt-4 grid gap-4 @min-[980px]:grid-cols-[1.4fr_1fr]">
        <section className="rounded-[12px] border border-line bg-surface px-5 py-3">
          <h2 className="pt-2 text-[17px] font-semibold">Before the first charge after a trial</h2>
          <SettingRow title="Charge only after the customer says yes" help="Pakka asks 24 hours before. If they don't answer, this cycle is skipped and the plan stays active." on={draft.askBeforeFirstCharge} onChange={(v) => set({ askBeforeFirstCharge: v })} />
          {saved.askBeforeFirstCharge && !draft.askBeforeFirstCharge && <p className="pb-2 text-[14px] text-amber">Customers will be asked only when Pakka&apos;s score is high, and charged if they don&apos;t answer.</p>}
          <SettingRow title={'Share "app opened since trial: yes or no"'} help="Only with the customer's consent, taken at trial sign-up. Nothing else about their usage is shared." on={draft.shareUsageSignal} onChange={(v) => set({ shareUsageSignal: v })} />
          <h2 className="pt-4 text-[17px] font-semibold">What customers can choose</h2>
          <SettingRow title="Skip this month" help="Customer keeps the plan and isn't charged this cycle." on={draft.offerSkip} onChange={(v) => set({ offerSkip: v })}>
            <label className="text-[14px] font-semibold" htmlFor="offer">Offer line shown beside Cancel (optional)</label>
            <input id="offer" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Is mahine skip karein, plan chalu rahega" className="mt-1 h-9 w-full rounded-[8px] border border-line-strong px-3 text-[14px]" />
            {issues.map((i) => (
              <div key={i.pattern + i.span} className="mt-2 text-[14px]">
                <b>{PATTERN_NAMES[i.pattern]}</b>: <span className="bg-amber-wash">{i.span}</span>. {i.why}
                <button onClick={() => setOffer(i.suggested_fix)} className="ml-2 font-semibold text-navy underline">Use this: {i.suggested_fix}</button>
              </div>
            ))}
          </SettingRow>
          <SettingRow title="Move to ₹149 monthly" help="Customer moves to a cheaper plan from the next cycle." on={false} onChange={() => undefined} />
          <p className="flex gap-2 py-3 text-[14px] text-slate"><Info size={18} className="shrink-0" aria-hidden />Pause and cancel always sit on the same screen as your offers, with equal weight.</p>
          <h2 className="pt-2 text-[17px] font-semibold">Refund rules</h2>
          <SettingRow title="Refund the first charge if the app wasn't opened within 48 hours" help="Money goes back to the same UPI account. Larger refunds come to you to decide." on={draft.refundAuto} onChange={(v) => set({ refundAuto: v })}>
            <div className="grid grid-cols-[160px_140px] items-center gap-2 text-[14px]">
              <label htmlFor="cap">Up to this amount</label>
              <input id="cap" value={inr(draft.refundCap)} onChange={(e) => set({ refundCap: Number(e.target.value.replace(/\D/g, "") || 0) * 100 })} className="h-9 rounded-[8px] border border-line-strong px-3 font-semibold" />
              <label htmlFor="lim">Daily limit</label>
              <input id="lim" value={inr(draft.refundDailyLimit)} onChange={(e) => set({ refundDailyLimit: Number(e.target.value.replace(/\D/g, "") || 0) * 100 })} className="h-9 rounded-[8px] border border-line-strong px-3 font-semibold" />
            </div>
          </SettingRow>
        </section>
        <div className="flex flex-col gap-4">
          <section className="rounded-[12px] border border-line bg-surface p-5">
            <h2 className="text-[17px] font-semibold">What customers see at checkout</h2>
            <div className="mt-3 rounded-[12px] border border-line p-4">
              <p className="text-[15px] font-semibold">PadhoAI Pro, 7 day trial</p>
              <p className="text-[14px] text-slate">₹1 today, then ₹599 a month</p>
              {draft.askBeforeFirstCharge && <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-cyan-wash px-3 py-1 text-[14px] font-semibold text-navy"><PakkaSeal label={false} />Charge karne se pehle poochenge</p>}
              <button className="mt-3 h-11 w-full rounded-[10px] bg-navy text-[15px] font-semibold text-white">Start trial with UPI AutoPay</button>
            </div>
          </section>
          <section className="rounded-[12px] border border-line bg-surface p-5">
            <h2 className="text-[17px] font-semibold">Last 7 days</h2>
            <div className="mt-2 grid grid-cols-2 divide-x divide-y divide-line border border-line">
              {[["18.4", "disputes per 1,000 charges"], ["41%", "trials end in a cancelled AutoPay"], [String(m.keptBySkipOrPause), "kept through skip or pause"], [inr(m.refundedUnderMerchantRules), "refunded under your rule"]].map(([v, l]) => (
                <div key={l} className="p-3"><div className="tnum text-[22px] font-bold">{v}</div><div className="text-[13.5px] text-slate">{l}</div></div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function RefundQueue({ s, now }: { s: Session; now: string }) {
  const send = useSync((x) => x.send);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("Plan terms allow refunds only within 7 days of purchase for quarterly plans.");
  const rows = [...s.state.refunds.values()].filter((r) => r.merchantId === MID && r.path === "merchant_queue");
  return (
    <>
      <p className="text-[14px] text-slate">Subscriptions / <span className="font-semibold text-ink">Refunds</span></p>
      <h1 className="text-[26px] font-bold text-navy">Customers waiting on you</h1>
      <table className="mt-4 w-full rounded-[12px] border border-line bg-surface text-[14px]">
        <thead><tr className="border-b border-line text-left text-slate"><th className="p-3">Customer</th><th>Plan</th><th>Amount</th><th>Charged</th><th>Why it came to you</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-slate">Nothing waiting.</td></tr>}
          {rows.map((r) => {
            const m = s.idx.mandate.get(r.mandateId)!;
            const charge = s.state.executions.get(r.executionId);
            const left = r.queuedUntil ? Math.max(0, Math.round((Date.parse(r.queuedUntil) - Date.parse(now)) / 3_600_000)) : 0;
            return (
              <tr key={r.executionId} className="border-b border-line last:border-b-0">
                <td className="p-3">{s.idx.user.get(m.userId)!.initials}</td>
                <td>{s.idx.plan.get(m.planId)!.name}</td>
                <td className="tnum font-semibold">{inr(r.amount)}</td>
                <td>{charge ? dayMonth(charge.at, "en") : ""}</td>
                <td>{r.amount > s.settings(MID).refundCap ? "Above the auto cap" : "Outside the 48 hour window"}</td>
                <td>{r.status === "with_merchant" ? `${left}h left` : r.status === "merchant_declined" ? "Declined, Paytm's team will review this with the customer." : r.status}</td>
                <td className="p-3 text-right">
                  {r.status === "with_merchant" && (declining === r.executionId ? (
                    <span className="flex gap-1"><input value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-64 rounded-[8px] border border-line-strong px-2" />
                      <button onClick={() => { void send({ kind: "merchant_refund_decision", executionId: r.executionId, decision: "decline", reason }); setDeclining(null); }} className="rounded-[8px] bg-navy px-2 text-white">Decline</button></span>
                  ) : (
                    <span className="flex justify-end gap-2">
                      <button onClick={() => send({ kind: "merchant_refund_decision", executionId: r.executionId, decision: "approve" })} className="h-8 rounded-[8px] bg-navy px-3 font-semibold text-white">Refund</button>
                      <button onClick={() => setDeclining(r.executionId)} className="h-8 rounded-[8px] border border-line-strong px-3 font-semibold text-navy">Decline with reason</button>
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

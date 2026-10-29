"use client";
// Small building blocks for the business console.
import { useEffect, useState } from "react";
import { CircleCheck, CircleX, Lock } from "lucide-react";
import { inr } from "@/lib/format";

export function Card({ title, right, children, className = "" }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[16px] border border-line bg-surface p-5 ${className}`}>
      {(title || right) && <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-[17px] font-semibold text-ink">{title}</h2>{right}</div>}
      {children}
    </section>
  );
}

export type Tone = "green" | "amber" | "red" | "navy" | "muted";
const TONE: Record<Tone, string> = {
  green: "bg-green-wash text-green", amber: "bg-amber-wash text-amber", red: "bg-red-wash text-red", navy: "bg-navy-wash text-navy", muted: "bg-[#EEF1F5] text-slate",
};
export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-[9px] py-px text-[13px] font-semibold leading-[18px] ${TONE[tone]}`}>{children}</span>;
}

export function Rule({ id }: { id?: string }) {
  if (!id) return null;
  return <span className="inline-block whitespace-nowrap rounded-[6px] border border-line px-1.5 font-mono text-[11.5px] leading-[18px] text-slate">{id}</span>;
}

export function Money({ paise, className = "" }: { paise: number; className?: string }) {
  return <span className={`tnum font-semibold ${className}`}>{inr(paise)}</span>;
}

export function Hash({ value, n = 10 }: { value: string; n?: number }) {
  return <span title={value} className="font-mono text-[12px] text-slate">{value.slice(0, n)}</span>;
}

export function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex gap-2 py-1 text-[14px]">
      {ok ? <CircleCheck size={16} className="mt-0.5 shrink-0 text-green" aria-label="Passed" /> : <CircleX size={16} className="mt-0.5 shrink-0 text-red" aria-label="Failed" />}
      <span><span className={ok ? "text-ink" : "font-semibold text-red"}>{label}</span>{detail && <span className="block text-[13px] text-slate">{detail}</span>}</span>
    </li>
  );
}

export function Bar({ value, max, tone = "navy" }: { value: number; max: number; tone?: "navy" | "amber" | "red" }) {
  const pct = Math.min(100, max ? (value / max) * 100 : 0);
  const color = tone === "red" ? "var(--red)" : tone === "amber" ? "var(--amber)" : "var(--navy)";
  return <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF1F5]"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>;
}

/** Step-up sheet: the person confirms with their PIN, which the engine checks and locks after three misses. */
export function PinSheet({ title, detail, onCancel, onConfirm }: { title: string; detail: string; onCancel: () => void; onConfirm: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,20,50,0.35)] anim-backdrop sm:items-center" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label={title} className="anim-sheet w-full max-w-[420px] rounded-t-[20px] bg-surface p-6 sm:rounded-[20px]" style={{ boxShadow: "var(--shadow-sheet)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-navy"><Lock size={18} aria-hidden /><h3 className="text-[18px] font-bold">{title}</h3></div>
        <p className="mt-2 text-[14.5px] text-slate">{detail}</p>
        <label htmlFor="b2b-pin" className="mt-4 block text-[14px] font-semibold">Your 6 digit PIN</label>
        <input id="b2b-pin" autoFocus inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter" && pin.length === 6) onConfirm(pin); }}
          className="tnum mt-1 h-11 w-full rounded-[8px] border border-line-strong px-3 text-[20px] tracking-[0.4em]" />
        <p className="mt-1 text-[12.5px] text-mist">Demo: any six digits except 000000. Three wrong tries lock you out for 15 minutes.</p>
        <div className="mt-5 flex gap-3">
          <button onClick={onCancel} className="h-11 flex-1 rounded-full border border-line-strong text-[15px] font-semibold text-navy">Cancel</button>
          <button disabled={pin.length !== 6} onClick={() => onConfirm(pin)} className="btn-primary h-11 flex-1 rounded-full text-[15px] font-semibold">Confirm and sign</button>
        </div>
      </div>
    </div>
  );
}

export function Toast({ text, tone, onClose }: { text: string; tone: "green" | "red"; onClose: () => void }) {
  useEffect(() => { const id = setTimeout(onClose, 5000); return () => clearTimeout(id); }, [text, onClose]);
  return (
    <div role="status" className="anim-toast fixed bottom-5 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-[12px] bg-ink px-4 py-3 text-[14.5px] text-white" style={{ boxShadow: "var(--shadow-float)" }}>
      {tone === "green" ? <CircleCheck size={18} className="text-[#7FE0B6]" aria-hidden /> : <CircleX size={18} className="text-[#FF9C9C]" aria-hidden />}
      <span>{text}</span>
      <button onClick={onClose} className="ml-2 text-[13px] font-semibold underline">Close</button>
    </div>
  );
}

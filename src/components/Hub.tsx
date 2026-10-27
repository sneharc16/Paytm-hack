"use client";
// Hub, / (PRD 20.0): start or join a session, pick a surface, scan to open the phone.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Clock, ShieldCheck, Smartphone, Store } from "lucide-react";
import { PakkaSeal } from "@/components/shared";
import { sessionIdFromUrl, SYNC_MODE } from "@/lib/sync/client";

export default function Hub() {
  const [id, setId] = useState("DEMO-7");
  const [qr, setQr] = useState("");
  useEffect(() => { setId(sessionIdFromUrl()); }, []);
  useEffect(() => {
    try { localStorage.setItem("pakka-session", id); } catch { /* storage blocked */ }
    const url = `${window.location.origin}/app?session=${id}&persona=sunita`;
    QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: "#002E6E", light: "#FFFFFF" } }).then(setQr).catch(() => setQr(""));
  }, [id]);
  const create = async () => {
    if (SYNC_MODE === "local") { setId(`DEMO-${10 + Math.floor(Math.random() * 90)}`); return; }
    const r = await fetch("/api/sessions", { method: "POST" }).then((x) => x.json());
    if (r.ok) setId(r.data.id);
  };
  const links = [
    { href: `/app?session=${id}`, label: "Customer app", Icon: Smartphone },
    { href: `/merchant?session=${id}`, label: "Merchant console", Icon: Store },
    { href: `/ops?session=${id}`, label: "Control room", Icon: ShieldCheck },
    { href: `/demo?session=${id}`, label: "Demo view", Icon: Clock },
  ];
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-4 py-12 sm:px-8">
      <div>
        <PakkaSeal />
        <h1 className="mt-3 text-[26px] font-bold leading-8 text-navy">An AI teammate for AutoPay that asks before money moves</h1>
        <p className="mt-1 text-[15px] text-slate">Prototype. All merchants and people are fictional. No real money moves.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={create} className="h-12 rounded-[10px] bg-navy px-5 text-[16px] font-semibold text-white">Start a new demo session</button>
        <span className="text-slate">or join</span>
        <input value={id} onChange={(e) => setId(e.target.value.toUpperCase())} className="h-12 w-32 rounded-[8px] border border-line-strong px-3 text-[16px] font-semibold" aria-label="Session code" />
        <a href={`/demo?session=${id}&grid=1`} className="text-[15px] font-semibold text-navy underline">One-laptop grid</a>
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {links.map(({ href, label, Icon }) => (
          <li key={label}><a href={href} className="flex h-28 flex-col justify-between rounded-[12px] border border-line bg-surface p-4 text-[16px] font-semibold text-navy hover:border-navy"><Icon size={22} strokeWidth={1.8} aria-hidden />{label}</a></li>
        ))}
      </ul>
      <div className="flex items-center gap-4">
        {qr && <img src={qr} alt={`QR code for session ${id}`} width={180} height={180} className="rounded-[12px] border border-line" />}
        <p className="max-w-xs text-[15px] text-slate">
          {SYNC_MODE === "local"
            ? <>Scan to open Sunita&apos;s app on a phone. The demo runs in each browser, so the phone has its own copy; tabs in this browser stay in sync. Session {id}.</>
            : <>Scan to open Sunita&apos;s app on a phone on the same network. Session {id}.</>}
        </p>
      </div>
    </main>
  );
}

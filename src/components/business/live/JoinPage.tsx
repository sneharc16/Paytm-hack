"use client";
// /business/live/join?org=..&invite=..#token: someone opens their invite and registers a passkey.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { joinCompany, previewInvite } from "@/lib/b2b/live-client";
import { PakkaSeal } from "@/components/shared";
import { Card, Pill } from "../ui";

const readRef = () => {
  const q = new URLSearchParams(window.location.search);
  return { org: q.get("org") ?? "", invite: q.get("invite") ?? "", token: window.location.hash.slice(1) };
};

export default function JoinPage() {
  const router = useRouter();
  const [info, setInfo] = useState<{ name: string; title: string; roles: string[]; company: string } | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const r = readRef();
    void previewInvite(r.org, r.invite, r.token).then((p) => (p.ok ? setInfo(p.data.invite) : setMsg("This invite is not open. Ask for a new link.")));
  }, []);
  const join = async () => {
    setMsg("");
    const ref = readRef();
    const r = await joinCompany(ref.org, ref.invite, ref.token);
    if (r.ok) router.push("/business/live");
    else setMsg(r.error.code === "PASSKEY_CANCELLED" ? "Passkey creation was cancelled." : r.error.message || r.error.code);
  };
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-white"><div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4"><Link href="/"><PakkaSeal /></Link><span className="text-[14px] font-semibold text-slate">for Business</span><Pill tone="green">Live</Pill></div></header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Card title={info ? `Join ${info.company}` : "Join"}>
          {info ? (
            <>
              <p className="text-[15px]">{info.name}, {info.title}. Roles: {info.roles.join(", ")}.</p>
              <p className="mt-2 text-[14px] text-slate">You will create a passkey on this device. It is how you sign in and how you sign every approval. No password, and nobody else can use it.</p>
              <button onClick={join} className="btn-primary mt-4 flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold"><KeyRound size={17} aria-hidden />Create my passkey and join</button>
            </>
          ) : !msg && <p className="text-[14px] text-slate">Checking the invite</p>}
          {msg && <p className="mt-3 text-[14px] font-semibold text-red" role="alert">{msg}</p>}
        </Card>
      </main>
    </div>
  );
}

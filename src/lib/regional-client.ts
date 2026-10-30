"use client";
// Regional copy and voice in the browser. Copy decks come from regional.json (baked) or, for a language not baked
// yet, from /api/voice/copy (translated by Sarvam on the server and checked line by line). Voice and listening go
// through /api/voice/*, so the Sarvam key stays on the server.
import { create } from "zustand";
import { isRegional, type UiLang } from "@/copy/languages";
import { hasTable, missingLines, setTable, type Table } from "@/copy/regional";

type Status = "ready" | "loading" | "unavailable";
interface RegionalState { version: number; status: Partial<Record<string, Status>>; ensure: (lang: UiLang) => Promise<void> }

const CACHE = "pakka-regional-v2";
function fromStorage(lang: string): Table | null {
  try { return (JSON.parse(localStorage.getItem(CACHE) ?? "{}") as Record<string, Table>)[lang] ?? null; } catch { return null; }
}
function toStorage(lang: string, t: Table) {
  try { const all = JSON.parse(localStorage.getItem(CACHE) ?? "{}"); all[lang] = t; localStorage.setItem(CACHE, JSON.stringify(all)); } catch { /* storage blocked */ }
}

export const useRegional = create<RegionalState>((set, get) => ({
  version: 0,
  status: {},
  async ensure(lang) {
    const st = get().status[lang];
    if (!isRegional(lang) || st === "loading" || st === "ready" || st === "unavailable") return;
    const ready = () => set({ version: get().version + 1, status: { ...get().status, [lang]: "ready" } });
    const stored = fromStorage(lang);
    if (stored && Object.keys(stored).length) setTable(lang, stored);
    // Complete (baked, or cached here): nothing to fetch. Otherwise the server fills the gaps live with Sarvam.
    if (hasTable(lang) && missingLines(lang).length === 0) { ready(); return; }
    const had = hasTable(lang);
    if (!had) set({ status: { ...get().status, [lang]: "loading" } });
    try {
      const r = (await fetch(`/api/voice/copy?lang=${lang}`).then((x) => x.json())) as { ok: boolean; data?: { table: Table } };
      if (r.ok && r.data && Object.keys(r.data.table).length) {
        setTable(lang, r.data.table);
        toStorage(lang, r.data.table);
        ready();
        return;
      }
    } catch { /* offline */ }
    // A baked deck still works for every line it has; new lines show in the base language.
    if (had) ready(); else set({ status: { ...get().status, [lang]: "unavailable" } });
  },
}));

/** Play `text` in `lang` with Sarvam's voice. Resolves false if the server has no voice (no key, or failure). */
export async function speakWithSarvam(text: string, lang: UiLang, onEnd: () => void): Promise<HTMLAudioElement | null> {
  try {
    const res = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, lang }) });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("audio/")) return null;
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); onEnd(); };
    await audio.play();
    return audio;
  } catch { return null; }
}

export interface Heard { transcript: string; language: UiLang | null; english: string | null }
/** Record from the microphone until stop() or 15 seconds, then ask Sarvam what was said. */
export async function startListening(onDone: (r: Heard | { error: string }) => void): Promise<{ stop: () => void } | { error: string }> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return { error: "NO_MIC" };
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return { error: "MIC_DENIED" }; }
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const form = new FormData();
    form.append("audio", new Blob(chunks, { type: rec.mimeType || "audio/webm" }), "speech.webm");
    try {
      const r = (await fetch("/api/voice/listen", { method: "POST", body: form }).then((x) => x.json())) as { ok: boolean; data?: Heard; error?: { code: string } };
      onDone(r.ok && r.data ? r.data : { error: r.error?.code ?? "LISTEN_FAILED" });
    } catch { onDone({ error: "NETWORK" }); }
  };
  rec.start();
  const timer = setTimeout(() => rec.state === "recording" && rec.stop(), 15_000);
  return { stop: () => { clearTimeout(timer); if (rec.state === "recording") rec.stop(); } };
}

/** English for the intake, from what the customer typed in any language. Null when Sarvam is not available. */
export async function toEnglish(text: string, from: UiLang): Promise<string | null> {
  try {
    const r = (await fetch("/api/voice/english", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, from }) }).then((x) => x.json())) as { ok: boolean; data?: { english: string } };
    return r.ok && r.data ? r.data.english : null;
  } catch { return null; }
}

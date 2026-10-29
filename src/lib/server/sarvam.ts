// The one place that calls Sarvam AI. Server only: it reads SARVAM_API_KEY. Every call has a timeout and returns
// { ok: false } on any failure, so callers fall back to hand-written copy or the browser's voice.
//   translate: Mayura (conversational) for the 11 languages it covers, Sarvam Translate for the other 11.
//   speak: Bulbul v3, 11 languages, WAV.
//   listen: Saaras v4, 23 languages, language detected automatically.
import { langInfo, LANGS, type UiLang } from "@/copy/languages";
import { sha256 } from "@/lib/hash";

const BASE = "https://api.sarvam.ai";
export type SarvamResult<T> = { ok: true; data: T } | { ok: false; reason: string; status?: number };

let fetcher: typeof fetch = (...a) => fetch(...a);
export function setSarvamFetchForTests(f: typeof fetch) { fetcher = f; }
export const sarvamKey = () => process.env.SARVAM_API_KEY ?? "";
export const sarvamEnabled = () => sarvamKey().length > 0;

async function call<T>(path: string, init: RequestInit, timeoutMs: number): Promise<SarvamResult<T>> {
  if (!sarvamEnabled()) return { ok: false, reason: "no_key" };
  try {
    const res = await fetcher(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), "api-subscription-key": sarvamKey() }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      return { ok: false, reason: body?.error?.code ?? `http_${res.status}`, status: res.status };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, reason: (e as Error).name === "TimeoutError" ? "timeout" : "network" };
  }
}

// ---------------- translate ----------------
const memo = new Map<string, string>();

export async function translate(text: string, target: UiLang, source: UiLang | "auto" = "en"): Promise<SarvamResult<string>> {
  const tgt = langInfo(target);
  const src = source === "auto" ? null : langInfo(source);
  const both = tgt.colloquial && (src ? src.colloquial : true);
  const model = both ? "mayura:v1" : "sarvam-translate:v1";
  const key = sha256(`${model}|${src?.sarvam ?? "auto"}|${tgt.sarvam}|${text}`);
  const hit = memo.get(key);
  if (hit !== undefined) return { ok: true, data: hit };
  if (src && src.sarvam === tgt.sarvam && source !== "hinglish" && target !== "hinglish") return { ok: true, data: text };
  const body: Record<string, unknown> = {
    input: text.slice(0, model === "mayura:v1" ? 1000 : 2000), source_language_code: src?.sarvam ?? (model === "mayura:v1" ? "auto" : "en-IN"),
    target_language_code: tgt.sarvam, model, numerals_format: "international",
  };
  if (model === "mayura:v1") {
    body.mode = target === "hinglish" ? "code-mixed" : "modern-colloquial";
    if (target === "hinglish") body.output_script = "roman";
  }
  const r = await call<{ translated_text: string }>("/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 10_000);
  if (!r.ok) return r;
  memo.set(key, r.data.translated_text);
  return { ok: true, data: r.data.translated_text };
}

// ---------------- speak ----------------
const VOICES: Partial<Record<UiLang, string>> = { hi: "priya", hinglish: "priya", en: "priya", ta: "kavitha", te: "shruti", kn: "roopa", ml: "kavya", bn: "ishita", mr: "shreya", gu: "suhani", pa: "simran", od: "tanya" };
const audioMemo = new Map<string, string>();

/** Base64 WAV of `text` spoken in `lang` (Bulbul v3). Languages Bulbul cannot speak are refused. */
export async function speak(text: string, lang: UiLang): Promise<SarvamResult<{ wav: string; lang: UiLang }>> {
  const info = langInfo(lang);
  if (!info.tts) return { ok: false, reason: "no_voice_for_language" };
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 2400);
  const key = sha256(`bulbul:v3|${info.sarvam}|${clean}`);
  const hit = audioMemo.get(key);
  if (hit) return { ok: true, data: { wav: hit, lang } };
  const r = await call<{ audios: string[] }>("/text-to-speech", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: clean, language_code: info.sarvam, model: "bulbul:v3", speaker: VOICES[lang] ?? "priya", pace: 0.95, speech_sample_rate: 22050 }),
  }, 15_000);
  if (!r.ok) return r;
  const wav = r.data.audios?.[0];
  if (!wav) return { ok: false, reason: "no_audio" };
  if (audioMemo.size > 200) audioMemo.clear();
  audioMemo.set(key, wav);
  return { ok: true, data: { wav, lang } };
}

// ---------------- listen ----------------
export async function listen(audio: Blob, hint?: UiLang): Promise<SarvamResult<{ transcript: string; language: UiLang | null; languageCode: string | null }>> {
  const form = new FormData();
  form.append("file", audio, "speech.webm");
  form.append("model", "saaras:v4");
  form.append("language_code", hint && hint !== "hinglish" ? langInfo(hint).sarvam : "unknown");
  form.append("keyterms", JSON.stringify(["AutoPay", "UPI", "refund", "PadhoAI", "StadiumPass", "Griha", "Pakka"]));
  const r = await call<{ transcript: string; language_code: string | null }>("/speech-to-text", { method: "POST", body: form }, 20_000);
  if (!r.ok) return r;
  const code = r.data.language_code;
  return { ok: true, data: { transcript: (r.data.transcript ?? "").trim(), languageCode: code, language: code ? LANGS.find((l) => l.sarvam === code && l.code !== "hinglish")?.code ?? null : null } };
}

// The voice and language API. The browser never sees the Sarvam key.
//   GET  /api/voice/copy?lang=ta   the whole customer copy deck in that language, every line fact-checked
//   POST /api/voice/speak          { text, lang } -> audio/wav (Bulbul)
//   POST /api/voice/listen         multipart { audio, hint? } -> { transcript, language, english } (Saaras, then Translate)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { isRegional, isUiLang, langInfo, type RegionalCode, type UiLang } from "@/copy/languages";
import { checkTranslation, forFormalModel, protect, restore, sourceLines, type Table } from "@/copy/regional";
import baked from "@/copy/regional.json";
import { listen, sarvamEnabled, speak, translate } from "./sarvam";

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message = code) => json(status, { ok: false, error: { code, message } });

const hits = new Map<string, { n: number; reset: number }>();
function limited(req: Request, perMinute: number): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now(), b = hits.get(ip);
  if (!b || b.reset < now) { hits.set(ip, { n: 1, reset: now + 60_000 }); return false; }
  return ++b.n > perMinute;
}

// ---------------- copy deck ----------------
const cacheFile = () => path.join(process.env.PAKKA_DATA_DIR ?? path.join(process.cwd(), ".pakka-data"), "regional-cache.json");
const decks = new Map<RegionalCode, Table>();
const inflight = new Map<RegionalCode, Promise<{ table: Table; failed: string[] }>>();
function readCache(): Record<string, Table> { try { return existsSync(cacheFile()) ? JSON.parse(readFileSync(cacheFile(), "utf8")) : {}; } catch { return {}; } }
function writeCache(lang: RegionalCode, table: Table) {
  try { mkdirSync(path.dirname(cacheFile()), { recursive: true }); writeFileSync(cacheFile(), JSON.stringify({ ...readCache(), [lang]: table })); } catch { /* read-only host: memory only */ }
}

/** Translate every line, a few at a time; keep only lines that pass the check. */
export async function translateDeck(lang: RegionalCode, skip: Table = {}): Promise<{ table: Table; failed: string[]; outOfCredits: boolean }> {
  const lines = Object.entries(sourceLines()).filter(([k]) => !(k in skip));
  const table: Table = {}, failed: string[] = [];
  let i = 0, outOfCredits = false;
  const worker = async () => {
    while (i < lines.length && !outOfCredits) {
      const [key, en] = lines[i++];
      const attempt = async (formal: boolean) => {
        const viaFormal = formal || !langInfo(lang).colloquial;
        const p = protect(viaFormal ? forFormalModel(en) : en);
        const r = await translate(p.text, lang, "en", { formal });
        const back = r.ok ? restore(r.data, p.names, p.counts) : null;
        const c = back !== null ? checkTranslation(en, back, lang) : null;
        return { ok: !!c?.ok, text: c?.text ?? "", why: !r.ok ? r.reason : back === null ? "markers" : c!.problems.join(",") };
      };
      // Conversational first; if that keeps English or loses a slot, the formal model gets one try.
      let a = await attempt(false);
      if (!a.ok && langInfo(lang).colloquial) a = await attempt(true);
      if (a.ok) table[key as keyof Table] = a.text; else failed.push(`${key}: ${a.why}`);
      if (a.why === "insufficient_quota_error") outOfCredits = true; // no point burning through the rest
    }
  };
  await Promise.all(Array.from({ length: 2 }, worker));
  return { table, failed, outOfCredits };
}

export async function copyDeck(req: Request): Promise<Response> {
  const lang = new URL(req.url).searchParams.get("lang") ?? "";
  if (!isRegional(lang)) return fail(400, "UNKNOWN_LANGUAGE");
  const bakedTable = (baked as { langs?: Record<string, Table> }).langs?.[lang];
  if (bakedTable && Object.keys(bakedTable).length) return json(200, { ok: true, data: { lang, table: bakedTable, source: "baked" } });
  const mem = decks.get(lang) ?? readCache()[lang];
  if (mem && Object.keys(mem).length) { decks.set(lang, mem); return json(200, { ok: true, data: { lang, table: mem, source: "cache" } }); }
  if (!sarvamEnabled()) return fail(503, "NO_SARVAM_KEY", "Set SARVAM_API_KEY to translate on demand");
  if (limited(req, 6)) return fail(429, "RATE_LIMITED");
  let p = inflight.get(lang);
  if (!p) { p = translateDeck(lang); inflight.set(lang, p); }
  try {
    const { table, failed } = await p;
    if (Object.keys(table).length) { decks.set(lang, table); writeCache(lang, table); }
    return json(200, { ok: true, data: { lang, table, source: "sarvam", failed: failed.length } });
  } finally { inflight.delete(lang); }
}

// ---------------- speak ----------------
export async function speakRoute(req: Request): Promise<Response> {
  if (limited(req, 30)) return fail(429, "RATE_LIMITED");
  const body = (await req.json().catch(() => null)) as { text?: unknown; lang?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const lang = typeof body?.lang === "string" && isUiLang(body.lang) ? body.lang : null;
  if (!text || text.length > 700 || !lang) return fail(400, "INVALID", "text up to 700 characters and a known lang");
  if (!sarvamEnabled()) return fail(503, "NO_SARVAM_KEY");
  // Bulbul cannot speak every scheduled language; those are read in Hindi.
  const voiceLang: UiLang = langInfo(lang).tts ? lang : "hi";
  let spoken = text;
  if (voiceLang !== lang) {
    const t = await translate(text, "hi", lang);
    if (!t.ok) return fail(502, "TRANSLATE_FAILED", t.reason);
    spoken = t.data;
  }
  const r = await speak(spoken, voiceLang);
  if (!r.ok) return fail(r.status === 429 ? 429 : 502, "SPEAK_FAILED", r.reason);
  const bytes = Uint8Array.from(atob(r.data.wav), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": "audio/wav", "cache-control": "private, max-age=3600", "x-voice-language": voiceLang } });
}

// ---------------- listen ----------------
export async function listenRoute(req: Request): Promise<Response> {
  if (limited(req, 20)) return fail(429, "RATE_LIMITED");
  if (!sarvamEnabled()) return fail(503, "NO_SARVAM_KEY");
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  const hint = form?.get("hint");
  if (!(audio instanceof Blob) || audio.size === 0) return fail(400, "INVALID", "audio required");
  if (audio.size > 2_000_000) return fail(413, "TOO_LONG", "Keep it under 30 seconds");
  const r = await listen(audio, typeof hint === "string" && isUiLang(hint) ? hint : undefined);
  if (!r.ok) return fail(r.status === 429 ? 429 : 502, "LISTEN_FAILED", r.reason);
  if (!r.data.transcript) return fail(422, "NOTHING_HEARD");
  // The intake reads English (and Hinglish) best; the customer keeps seeing their own words.
  const english = r.data.language === "en" ? r.data.transcript : await translate(r.data.transcript, "en", r.data.language ?? "auto");
  return json(200, { ok: true, data: { transcript: r.data.transcript.slice(0, 300), language: r.data.language, languageCode: r.data.languageCode, english: typeof english === "string" ? english : english.ok ? english.data.slice(0, 300) : null } });
}

// ---------------- translate a customer's own words ----------------
/** POST { text, from? } -> English, for the intake. Up to 300 characters. */
export async function toEnglishRoute(req: Request): Promise<Response> {
  if (limited(req, 30)) return fail(429, "RATE_LIMITED");
  const body = (await req.json().catch(() => null)) as { text?: unknown; from?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 300) return fail(400, "INVALID");
  if (!sarvamEnabled()) return fail(503, "NO_SARVAM_KEY");
  const from = typeof body?.from === "string" && isUiLang(body.from) ? body.from : "auto";
  const r = await translate(text, "en", from);
  return r.ok ? json(200, { ok: true, data: { english: r.data.slice(0, 300) } }) : fail(502, "TRANSLATE_FAILED", r.reason);
}

export function resetVoiceCachesForTests() { decks.clear(); inflight.clear(); }

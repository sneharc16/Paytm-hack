// src/llm/tts/browser.ts: the browser's own speechSynthesis, Indian voices only. Ranked by exact locale
// (hi-IN for Hindi and Hinglish, en-IN for English), then by known Indian voice names on Chrome, Edge, Android,
// iOS and macOS, then by any other Indian locale. Never a US or UK voice: no Indian voice means text only.
import type { SpeakRequest, Speaking, TtsProvider, VoiceLang } from "./types";

export interface VoiceLike { name: string; lang: string; localService?: boolean }

/** Names of Indian voices we have seen, lower case. */
export const INDIAN_VOICE_NAMES = [
  "google हिन्दी", "google hindi", "lekha", "rishi", "veena", "aman", "tara", "soumya", "kiyara",
  "microsoft swara", "microsoft madhur", "microsoft hemant", "microsoft kalpana", "microsoft heera", "microsoft ravi",
  "microsoft neerja", "microsoft prabhat", "microsoft aarav", "microsoft ananya", "microsoft kavya", "microsoft kunal",
  "hi-in-x-", "en-in-x-",
];

const norm = (l: string) => l.replace("_", "-").toLowerCase();
const isIndianLocale = (l: string) => /-in$/.test(norm(l));
const knownIndianName = (n: string) => INDIAN_VOICE_NAMES.some((k) => n.toLowerCase().includes(k));

/** The best Indian voice for the language, or null. Pure, so it is tested without a browser. */
export function pickVoice<V extends VoiceLike>(voices: V[], language: VoiceLang): V | null {
  const want = language === "en" ? "en-in" : "hi-in";
  const second = language === "en" ? "hi-in" : "en-in";
  const score = (v: V) => {
    const l = norm(v.lang);
    const indian = isIndianLocale(l) || knownIndianName(v.name);
    if (!indian) return -1;
    // Locale first, then a known name, then a local (offline) voice.
    return (l === want ? 100 : l === second ? 40 : isIndianLocale(l) ? 20 : 10) + (knownIndianName(v.name) ? 5 : 0) + (v.localService ? 1 : 0);
  };
  // A voice whose locale says US or UK never qualifies, whatever its name.
  const ok = voices.filter((v) => !/^en-(us|gb|au|ca|ie|nz|za)$/.test(norm(v.lang)) && score(v) >= 0);
  ok.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  return ok[0] ?? null;
}

/** Voices load asynchronously in Chrome: wait for them briefly. */
function loadVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((ok) => {
    const t = setTimeout(() => ok(synth.getVoices()), 1200);
    synth.addEventListener?.("voiceschanged", () => { clearTimeout(t); ok(synth.getVoices()); }, { once: true });
  });
}

export const browser: TtsProvider = {
  id: "browser",
  async speak(req: SpeakRequest) {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return null;
    const voice = pickVoice(await loadVoices(synth), req.language);
    if (!voice) return null;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(req.text);
    u.voice = voice;
    u.lang = voice.lang;
    let finish = () => {};
    const done = new Promise<void>((ok) => { finish = ok; });
    u.onend = () => finish();
    u.onerror = () => finish();
    synth.speak(u);
    const s: Speaking = { provider: "browser", voice: voice.name, stop: () => { synth.cancel(); finish(); }, done };
    return s;
  },
};

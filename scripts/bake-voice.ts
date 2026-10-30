// Record the story's voice notes once with Indian voices on macOS (say + afconvert), so the stage demo never
// depends on the visitor's browser voices. Runs the story with the baked model texts, takes every reminder sent
// to the four demo customers, and writes public/audio/v/<hash>.m4a plus src/llm/tts/voice-manifest.json.
// Run after pnpm bake:llm (the notes follow the texts). Usage: pnpm bake:voice   (--dry-run to list only)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tick } from "@/engine/agent";
import { DEMO_END } from "@/engine/clock";
import { Session } from "@/engine/session";
import type { Lang } from "@/engine/types";
import { generateWorld } from "@/engine/world";
import { sha256 } from "@/lib/hash";
import { nudgeVoiceText } from "@/lib/voice";
import { installModelHooks } from "@/llm/hooks";
import { speakable } from "@/llm/tts";
import { noteKey, type VoiceNote } from "@/llm/tts/recorded";

/** hi-IN for Hindi and Hinglish, en-IN for English (see docs/DECISIONS.md). */
export const VOICE_FOR: Record<Lang, string> = { hi: "Lekha", hinglish: "Lekha", en: "Rishi" };
const DEMO_USERS = new Set(["u_sunita", "u_rahul", "u_farhan", "u_anjali"]);
const OUT = "public/audio/v";
const MANIFEST = "src/llm/tts/voice-manifest.json";

function main() {
  installModelHooks();
  const s = new Session("VOICE", generateWorld("2711"));
  tick(s, DEMO_END);
  const texts = new Map<string, { text: string; language: Lang }>();
  for (const e of s.events) {
    if (e.type !== "nudge_sent" || !e.payload.cycleId || !DEMO_USERS.has(e.payload.userId)) continue;
    const m = s.mandateOf(e.payload.cycleId);
    const text = nudgeVoiceText(e, s.idx.merchant.get(m.merchantId)!);
    const language = e.payload.language as Lang;
    if (!speakable({ text })) { console.warn(`Skipped (personal data): ${text.slice(0, 40)}`); continue; }
    texts.set(noteKey(language, text), { text, language });
  }
  console.log(`${texts.size} voice notes`);
  if (process.argv.includes("--dry-run")) { for (const t of texts.values()) console.log(`[${t.language}] ${t.text}`); return; }

  const installed = execFileSync("say", ["-v", "?"], { encoding: "utf8" });
  for (const v of new Set(Object.values(VOICE_FOR))) if (!installed.includes(v)) throw new Error(`macOS voice ${v} is not installed (System Settings, Accessibility, Spoken Content)`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const notes: Record<string, VoiceNote> = {};
  const tmp = path.join(tmpdir(), "pakka-voice.aiff");
  for (const [key, { text, language }] of texts) {
    const voice = VOICE_FOR[language];
    const file = `${OUT}/${sha256(`${voice}|${text}`).slice(0, 16)}.m4a`;
    if (!existsSync(file)) {
      execFileSync("say", ["-v", voice, "-o", tmp, text]);
      execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "48000", tmp, file]);
    }
    notes[key] = { file: file.replace(/^public/, ""), voice, language };
  }
  rmSync(tmp, { force: true });
  writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), voices: VOICE_FOR, notes }, null, 1) + "\n");
  console.log(`Wrote ${Object.keys(notes).length} notes to ${OUT} and ${MANIFEST}`);
}

main();

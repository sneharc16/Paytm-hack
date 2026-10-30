// src/llm/tts/recorded.ts: pre-made voice notes (pnpm bake:voice), so the stage demo never depends on the
// visitor's browser voices. Files are named by a hash of text and voice; the manifest maps language and text
// to the file and the voice that recorded it.
import { sha256 } from "@/lib/hash";
import manifest from "./voice-manifest.json";
import type { SpeakRequest, Speaking, TtsProvider, VoiceLang } from "./types";

export interface VoiceNote { file: string; voice: string; language: VoiceLang }
const notes = (manifest as { notes?: Record<string, VoiceNote> }).notes ?? {};

export const noteKey = (language: VoiceLang, text: string) => sha256(`${language}|${text.trim()}`);
export const recordedNote = (req: Pick<SpeakRequest, "language" | "text">): VoiceNote | undefined => notes[noteKey(req.language, req.text)];

export const recorded: TtsProvider = {
  id: "recorded",
  async speak(req) {
    const note = recordedNote(req);
    if (!note || typeof Audio === "undefined") return null;
    const audio = new Audio(note.file);
    let finish = () => {};
    const done = new Promise<void>((ok) => { finish = ok; });
    audio.onended = () => finish();
    try {
      await audio.play();
    } catch {
      return null;
    }
    const s: Speaking = { provider: "recorded", voice: note.voice, stop: () => { audio.pause(); finish(); }, done };
    return s;
  },
};

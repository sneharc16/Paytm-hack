// src/llm/tts/index.ts: speak({ text, language }). Order: a recorded note, then Sarvam (next build, empty
// slot), then the browser's Indian voice, then text only. The script is checked for personal data first:
// anything found means text only, so no voice ever says a phone number, UPI ID or account.
import { piiIn } from "@/lib/privacy/mask";
import { browser } from "./browser";
import { recorded } from "./recorded";
import { sarvam } from "./sarvam";
import type { SpeakRequest, Speaking, TtsProvider } from "./types";

export type { SpeakRequest, Speaking, VoiceLang } from "./types";
export { pickVoice } from "./browser";
export { recordedNote } from "./recorded";

export const PROVIDERS: TtsProvider[] = [recorded, ...(sarvam ? [sarvam] : []), browser];

const textOnly = (reason: Speaking["reason"]): Speaking => ({ provider: "text", reason, stop: () => {}, done: Promise.resolve() });

/** True when the script may be spoken: no personal values and no masking tokens. */
export function speakable(req: Pick<SpeakRequest, "text" | "names">): boolean {
  return !piiIn(req.text, { names: req.names }).length && !/<[A-Z]+_\d+>/.test(req.text);
}

export async function speak(req: SpeakRequest, providers: TtsProvider[] = PROVIDERS): Promise<Speaking> {
  if (!speakable(req)) return textOnly("pii");
  for (const p of providers) {
    try {
      const s = await p.speak(req);
      if (s) return s;
    } catch {
      // try the next provider
    }
  }
  return textOnly("no_indian_voice");
}

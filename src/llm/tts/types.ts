// src/llm/tts/types.ts: one interface for every voice provider.
export type VoiceLang = "hi" | "hinglish" | "en";

export interface SpeakRequest {
  text: string;
  language: VoiceLang;
  /** The customer's own name(s), so the privacy check can find them too. */
  names?: string[];
}

export type ProviderId = "recorded" | "sarvam" | "browser" | "text";

/** A voice that is playing (or the text-only result). stop() is safe to call at any time. */
export interface Speaking {
  provider: ProviderId;
  voice?: string;
  /** Why it fell back to text only. */
  reason?: "pii" | "no_indian_voice" | "unavailable";
  stop(): void;
  /** Resolves when playback ends or is stopped. */
  done: Promise<void>;
}

export interface TtsProvider {
  id: Exclude<ProviderId, "text">;
  /** null when this provider cannot speak this request; then the next one is tried. */
  speak(req: SpeakRequest): Promise<Speaking | null>;
}

// src/llm/tts/sarvam.ts: RESERVED SLOT for Sarvam Bulbul (Indian TTS), planned for the next build.
// Not called in this build: no paid or third-party voice calls. To add it, implement a TtsProvider here that
// fetches audio from a server route (the API key must stay on the server, e.g. SARVAM_API_KEY), and export it
// instead of null. The registry in index.ts already tries it between recorded notes and the browser voice.
import type { TtsProvider } from "./types";

export const sarvam: TtsProvider | null = null;

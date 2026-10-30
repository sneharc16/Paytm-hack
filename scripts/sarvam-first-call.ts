// pnpm sarvam:first-call: one text to speech call with the Sarvam SDK (Bulbul v3). Reads SARVAM_API_KEY from the
// environment and saves the audio to .pakka-data/sarvam-first-call.wav (git-ignored).
import { mkdirSync, writeFileSync } from "node:fs";
import { SarvamAIClient } from "sarvamai";

async function main() {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY is not set. Put it in .env");
  const client = new SarvamAIClient({ apiSubscriptionKey: key });
  const text = "नमस्ते सुनीता जी। कल रात साढ़े नौ बजे के बाद PadhoAI का ₹599 का AutoPay कटेगा।";
  const res = await client.textToSpeech.convert({ text, language_code: "hi-IN", model: "bulbul:v3", speaker: "priya" });
  const wav = Buffer.from(res.audios[0], "base64");
  mkdirSync(".pakka-data", { recursive: true });
  writeFileSync(".pakka-data/sarvam-first-call.wav", wav);
  console.log(`request ${res.request_id ?? "-"}: ${wav.length} bytes of WAV saved to .pakka-data/sarvam-first-call.wav`);
}

main().catch((e) => { console.error(e?.statusCode ? `Sarvam error ${e.statusCode}: ${JSON.stringify(e.body)}` : String(e)); process.exit(1); });

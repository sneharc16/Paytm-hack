import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANGS, REGIONAL, baseLang, fromSarvam } from "@/copy/languages";
import { checkTranslation, clearTableForTests, forFormalModel, hasTable, protect, restore, setTable, sourceLines, tr, uiRelativeDay } from "@/copy/regional";
import baked from "@/copy/regional.json";
import { STRINGS } from "@/copy/strings";
import { listen, setSarvamFetchForTests, speak, translate } from "@/lib/server/sarvam";
import { copyDeck, listenRoute, resetVoiceCachesForTests, speakRoute, withoutAddedBrands } from "@/lib/server/voice";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("languages", () => {
  it("covers Hindi, Hinglish, English and all 21 other scheduled languages Sarvam translates", () => {
    expect(LANGS).toHaveLength(24);
    expect(REGIONAL).toHaveLength(21);
    expect(new Set(LANGS.map((l) => l.code)).size).toBe(24);
    expect(LANGS.filter((l) => l.tts).map((l) => l.sarvam).sort()).toEqual(["bn-IN", "en-IN", "gu-IN", "hi-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"]);
  });
  it("falls back to Hindi for Devanagari languages and English for the rest", () => {
    expect(baseLang("mr")).toBe("hi");
    expect(baseLang("ta")).toBe("en");
    expect(fromSarvam("ta-IN")).toBe("ta");
    expect(fromSarvam("hi-IN")).toBe("hi");
  });
});

describe("checking a translation before it is shown", () => {
  it("accepts a faithful line in the right script", () => {
    expect(checkTranslation("{amount} goes to {brand} {day}", "{amount} {day} {brand}க்கு செல்லும்", "ta").ok).toBe(true);
  });
  it("refuses lost placeholders, changed numbers, wrong script and markup, and removes dashes", () => {
    expect(checkTranslation("{amount} goes to {brand}", "தொகை செல்லும்", "ta").problems).toContain("placeholders");
    expect(checkTranslation("after 9:30 PM", "இரவு 8:30 க்குப் பிறகு", "ta").problems).toContain("numbers");
    expect(checkTranslation("Take a look", "Take a look", "ta").problems).toContain("script");
    expect(checkTranslation("Take a look", "<b>பாருங்கள்</b>", "ta").problems).toContain("markup");
    expect(checkTranslation("Done", "முடிந்தது — சரி", "ta").text).toBe("முடிந்தது, சரி");
  });
});

describe("regional copy", () => {
  it("shows the base language until a checked table exists, then the table with parameters", () => {
    clearTableForTests("gu"); clearTableForTests("mr"); clearTableForTests("kn");
    expect(tr("gu", "pill.done")).toBe(STRINGS["pill.done"].en);
    expect(tr("mr", "pill.done")).toBe(STRINGS["pill.done"].hi);
    setTable("kn", { "pill.done": "ಆಯಿತು", "sheet.title": "{amount} {brand}ಗೆ {day}", "rel.tomorrow": "ನಾಳೆ" });
    expect(hasTable("kn")).toBe(true);
    expect(tr("kn", "pill.done")).toBe("ಆಯಿತು");
    expect(tr("kn", "sheet.title", { amount: "₹599", brand: "PadhoAI", day: "ನಾಳೆ" })).toBe("₹599 PadhoAIಗೆ ನಾಳೆ");
    expect(uiRelativeDay("2026-10-27T18:00:00.000Z", "2026-10-26T18:00:00.000Z", "kn")).toBe("ನಾಳೆ");
    setTable("ta", { "sheet.title": "{amount} {brand} {day}-க்கு போகுது" });
    expect(tr("ta", "sheet.title", { amount: "₹599", brand: "PadhoAI", day: "நாளைக்கு" })).toBe("₹599 PadhoAI நாளைக்கு போகுது");
    expect(tr("ta", "sheet.title", { amount: "₹599", brand: "PadhoAI", day: "27 Oct" })).toBe("₹599 PadhoAI 27 Oct-க்கு போகுது");
  });
  it("only ships baked lines that pass the check, with no dashes", () => {
    const src = sourceLines();
    for (const [lang, table] of Object.entries((baked as { langs: Record<string, Record<string, string>> }).langs)) {
      for (const [k, v] of Object.entries(table)) {
        const c = checkTranslation(src[k], v, lang as never);
        expect(c.ok, `${lang} ${k}: ${c.problems}`).toBe(true);
        expect(/[–—]/.test(v)).toBe(false);
      }
    }
  });
});

// ---------------- the Sarvam client, against a fake Sarvam ----------------
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
function fakeSarvam(reply: (url: string, init: RequestInit) => unknown, status = 200) {
  calls = [];
  setSarvamFetchForTests((async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(reply(String(url), init)), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch);
}

describe("Sarvam client", () => {
  beforeEach(() => { vi.stubEnv("SARVAM_API_KEY", "sk_test_123"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("does nothing without a key", async () => {
    vi.stubEnv("SARVAM_API_KEY", "");
    expect(await translate("Done", "ta")).toEqual({ ok: false, reason: "no_key" });
  });
  it("translates with Mayura in a conversational register where it can, and Sarvam Translate elsewhere", async () => {
    fakeSarvam(() => ({ translated_text: "முடிந்தது", source_language_code: "en-IN" }));
    const r = await translate("Done twice", "ta");
    expect(r).toEqual({ ok: true, data: "முடிந்தது" });
    const body = JSON.parse(calls[0].init.body as string);
    expect(calls[0].url).toBe("https://api.sarvam.ai/translate");
    expect((calls[0].init.headers as Record<string, string>)["api-subscription-key"]).toBe("sk_test_123");
    expect(body).toMatchObject({ model: "mayura:v1", mode: "modern-colloquial", source_language_code: "en-IN", target_language_code: "ta-IN", numerals_format: "international" });
    fakeSarvam(() => ({ translated_text: "ہو گیا" }));
    await translate("Done thrice", "ur");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ model: "sarvam-translate:v1", target_language_code: "ur-IN" });
    expect(JSON.parse(calls[0].init.body as string).mode).toBeUndefined();
  });
  it("speaks with Bulbul v3 and refuses languages Bulbul cannot speak", async () => {
    fakeSarvam(() => ({ request_id: "r1", audios: ["UklGRg=="] }));
    const r = await speak("₹599 நாளை", "ta");
    expect(r.ok && r.data.wav).toBe("UklGRg==");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ model: "bulbul:v3", language_code: "ta-IN", speaker: "kavitha" });
    expect(await speak("x", "ur")).toEqual({ ok: false, reason: "no_voice_for_language" });
  });
  it("listens with Saaras v4 and detects the language", async () => {
    fakeSarvam(() => ({ transcript: "இந்த 599 ஏன்?", language_code: "ta-IN", language_probability: 0.97 }));
    const r = await listen(new Blob([new Uint8Array(10)], { type: "audio/webm;codecs=opus" }));
    expect(r.ok && r.data).toMatchObject({ transcript: "இந்த 599 ஏன்?", language: "ta" });
    const form = calls[0].init.body as FormData;
    expect(form.get("model")).toBe("saaras:v4");
    expect(form.get("language_code")).toBe("unknown");
    // Sarvam rejects "audio/webm;codecs=opus", which is what Chrome records.
    expect((form.get("file") as File).type).toBe("audio/webm");
  });
  it("takes out a payment brand the translation added", () => {
    expect(withoutAddedBrands("Why is 599 rupees being deducted from my Paytm account tomorrow?", "நாளைக்கு 599 ரூபாய் ஏன் கட் ஆகுது?")).toBe("Why is 599 rupees being deducted from my account tomorrow?");
    expect(withoutAddedBrands("Paytm took my money", "Paytm ne paise kaate")).toBe("Paytm took my money");
    expect(withoutAddedBrands("My credit card was charged", "x")).toBe("My credit card was charged");
  });
  it("names a Safari recording as m4a", async () => {
    fakeSarvam(() => ({ transcript: "हाँ", language_code: "hi-IN" }));
    await listen(new Blob([new Uint8Array(10)], { type: "audio/mp4" }));
    const file = (calls[0].init.body as FormData).get("file") as File;
    expect([file.type, file.name]).toEqual(["audio/mp4", "speech.m4a"]);
  });
  it("reports Sarvam's error code", async () => {
    fakeSarvam(() => ({ error: { code: "invalid_api_key_error", message: "x" } }), 403);
    expect(await translate("Quota", "bn")).toMatchObject({ ok: false, reason: "invalid_api_key_error", status: 403 });
  });
  it("waits out a rate limit and tries again", async () => {
    let n = 0;
    setSarvamFetchForTests((async () => (++n === 1
      ? new Response(JSON.stringify({ error: { code: "rate_limit_exceeded_error" } }), { status: 429, headers: { "retry-after": "1" } })
      : new Response(JSON.stringify({ translated_text: "হয়ে গেছে" }), { status: 200 }))) as unknown as typeof fetch);
    expect(await translate("Done after a wait", "bn")).toEqual({ ok: true, data: "হয়ে গেছে" });
    expect(n).toBe(2);
  });
  it("makes money words unambiguous for the formal model", () => {
    expect(forFormalModel("{brand}'s first {amount} charge after the trial")).toBe("{brand}'s first {amount} debit after the trial period");
    expect(forFormalModel("Past charges. Charged. It will be charged. Trial period")).toBe("Past debits. Debited. It will be debited. Trial period");
  });
  it("swaps slots for markers Sarvam keeps, and rejects lines that lose or double one", () => {
    const p = protect("{amount} goes to {brand} {day}, {amount}");
    expect(p).toEqual({ text: "#1# goes to #2# #3#, #1#", names: ["amount", "brand", "day"], counts: [2, 1, 1] });
    expect(restore("#1# #2# #3# #1#", p.names, p.counts)).toBe("{amount} {brand} {day} {amount}");
    expect(restore("#1# #2# #3#", p.names, p.counts)).toBeNull();
    expect(restore("#1# #2# #3#-க்கு போகுது", ["amount", "brand", "day"])).toBe("{amount} {brand} {day}-க்கு போகுது");
    expect(restore("#1-க்கு அனுப்பிச்சிருக்கேன்#", ["brand"])).toBe("{brand}-க்கு அனுப்பிச்சிருக்கேன்");
    expect(restore("#1# #3#", ["amount", "brand", "day"])).toBeNull();
    expect(restore("#1# #1# #2#", ["amount", "brand"])).toBeNull();
    expect(restore("#1# #2# #4#", ["amount", "brand", "day"])).toBeNull();
  });
});

describe("voice routes", () => {
  beforeEach(() => { vi.stubEnv("SARVAM_API_KEY", "sk_test_123"); vi.stubEnv("PAKKA_DATA_DIR", mkdtempSync(path.join(tmpdir(), "pakka-voice-"))); resetVoiceCachesForTests(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("serves baked copy without a key, and says so plainly when voice needs one", async () => {
    vi.stubEnv("SARVAM_API_KEY", "");
    const baked = await (await copyDeck(new Request("http://x/api/voice/copy?lang=ta"))).json();
    expect(baked.data.source).toBe("baked");
    expect(Object.keys(baked.data.table).length).toBeGreaterThan(100);
    const r = await speakRoute(new Request("http://x/api/voice/speak", { method: "POST", body: JSON.stringify({ text: "नमस्ते", lang: "hi" }) }));
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("NO_SARVAM_KEY");
  });
  it("translates the deck and keeps only lines that pass the check", async () => {
    // A fake that returns Gurmukhi but drops placeholders on one line.
    fakeSarvam((_u, init) => {
      const input = JSON.parse(init.body as string).input as string;
      const ph = (input.match(/#\d+#/g) ?? []).join(" ");
      const nums = (input.replace(/#\d+#/g, "").match(/\d+/g) ?? []).join(" ");
      return { translated_text: input === "Done" ? "ਹੋ ਗਿਆ" : input.startsWith("Refunded") ? "ਪੈਸਾ ਵਾਪਸ" : `ਪੰਜਾਬੀ ${nums} ${ph}`.trim() };
    });
    const { translateDeck } = await import("@/lib/server/voice");
    const body = { ok: true, data: await translateDeck("pa") };
    expect(body.ok).toBe(true);
    expect(body.data.table["pill.done"]).toBe("ਹੋ ਗਿਆ");
    expect(body.data.table["sheet.title"]).toContain("{amount}");
    expect(Object.keys(body.data.table).length).toBeGreaterThan(100);
  });
  it("returns WAV audio for speak and a transcript with English for listen", async () => {
    fakeSarvam((url) => (url.endsWith("/text-to-speech") ? { audios: ["UklGRiQAAABXQVZF"] } : url.endsWith("/speech-to-text") ? { transcript: "ये ₹599 क्यों कटेगा", language_code: "hi-IN" } : { translated_text: "Why will this ₹599 be charged" }));
    const sp = await speakRoute(new Request("http://x/api/voice/speak", { method: "POST", body: JSON.stringify({ text: "नमस्ते", lang: "hi" }) }));
    expect(sp.headers.get("content-type")).toBe("audio/wav");
    expect((await sp.arrayBuffer()).byteLength).toBeGreaterThan(4);
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(100)], { type: "audio/webm" }), "a.webm");
    const li = await (await listenRoute(new Request("http://x/api/voice/listen", { method: "POST", body: form }))).json();
    expect(li.data).toMatchObject({ transcript: "ये ₹599 क्यों कटेगा", language: "hi", english: "Why will this ₹599 be charged" });
  });
  it("reads unspoken languages in Hindi", async () => {
    fakeSarvam((url) => (url.endsWith("/translate") ? { translated_text: "नमस्ते" } : { audios: ["UklGRiQAAABXQVZF"] }));
    const sp = await speakRoute(new Request("http://x/api/voice/speak", { method: "POST", body: JSON.stringify({ text: "آداب", lang: "ur" }) }));
    expect(sp.headers.get("x-voice-language")).toBe("hi");
  });
});

describe("Sarvam as the chat model", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("asks Sarvam 105B Conversations for schema-checked JSON and falls back on bad output", async () => {
    const { runTask, setSarvamForTests, provider } = await import("@/llm/client");
    vi.stubEnv("LLM_PROVIDER", "sarvam");
    vi.stubEnv("SARVAM_API_KEY", "sk_test");
    expect(provider()).toBe("sarvam");
    const seen: Record<string, unknown>[] = [];
    // A single-call task (L5 lint). Reviewed tasks (L1, L3, L4, L6) run the three-agent loop, tested in agents.test.ts.
    let reply = JSON.stringify({ pass: false, issues: [{ pattern: "confirm_shaming", span: "aap pachhtayenge", why: "guilt", suggested_fix: "Jab chahein wapas aa sakte hain." }] });
    setSarvamForTests({ chat: { completions: async (req: Record<string, unknown>) => { seen.push(req); return { model: "sarvam-105b-conversations", choices: [{ finish_reason: "stop", message: { content: reply } }] }; } } });
    const ok = await runTask("lint", { text: "aap pachhtayenge test-a" }, { useDemoCache: false });
    expect(ok.ok && ok.output).toMatchObject({ pass: false, issues: [{ pattern: "confirm_shaming" }] });
    expect(seen[0]).toMatchObject({ model: "sarvam-105b-conversations", reasoning_effort: "low", response_format: { type: "json_schema" } });
    reply = JSON.stringify({ pass: "maybe" });
    const bad = await runTask("lint", { text: "something else entirely test-b" }, { useDemoCache: false });
    expect(bad).toMatchObject({ ok: false, reason: "invalid_output" });
    setSarvamForTests(null);
  }, 30_000); // the first import loads three model SDKs
});

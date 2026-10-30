import { describe, expect, it } from "vitest";
import { pickVoice, speak, speakable } from "@/llm/tts";
import type { TtsProvider } from "@/llm/tts/types";

const V = (name: string, lang: string, localService = false) => ({ name, lang, localService });
const CHROME = [V("Google US English", "en-US"), V("Google UK English Female", "en-GB"), V("Google हिन्दी", "hi-IN")];
const MAC = [V("Samantha", "en-US", true), V("Daniel", "en-GB", true), V("Lekha", "hi-IN", true), V("Rishi", "en-IN", true)];
const EDGE = [V("Microsoft Aria Online (Natural) - English (United States)", "en-US"), V("Microsoft Swara Online (Natural) - Hindi (India)", "hi-IN"), V("Microsoft Neerja Online (Natural) - English (India)", "en-IN")];
const ANDROID = [V("en-us-x-sfg-local", "en-US"), V("hi-in-x-hia-local", "hi_IN"), V("en-in-x-ena-network", "en_IN")];

describe("Indian voice selection", () => {
  it("prefers hi-IN for Hindi and Hinglish and en-IN for English", () => {
    expect(pickVoice(MAC, "hi")?.name).toBe("Lekha");
    expect(pickVoice(MAC, "hinglish")?.name).toBe("Lekha");
    expect(pickVoice(MAC, "en")?.name).toBe("Rishi");
    expect(pickVoice(EDGE, "en")?.name).toContain("Neerja");
    expect(pickVoice(EDGE, "hi")?.name).toContain("Swara");
    expect(pickVoice(ANDROID, "hi")?.name).toBe("hi-in-x-hia-local");
    expect(pickVoice(ANDROID, "en")?.name).toBe("en-in-x-ena-network");
  });

  it("uses another Indian voice before giving up, and never a US or UK voice", () => {
    expect(pickVoice(CHROME, "en")?.name).toBe("Google हिन्दी");
    expect(pickVoice([V("Google US English", "en-US"), V("Daniel", "en-GB")], "en")).toBeNull();
    expect(pickVoice([V("Rishi (Enhanced)", "en-US")], "en")).toBeNull();
  });
});

describe("speak()", () => {
  const fake = (id: "recorded" | "browser", ok: boolean, log: string[]): TtsProvider => ({
    id, speak: async () => { log.push(id); return ok ? { provider: id, voice: id, stop() {}, done: Promise.resolve() } : null; },
  });

  it("falls back from recorded to browser to text", async () => {
    const log: string[] = [];
    expect((await speak({ text: "PadhoAI ₹599 kal", language: "hinglish" }, [fake("recorded", true, log), fake("browser", true, log)])).provider).toBe("recorded");
    expect((await speak({ text: "PadhoAI ₹599 kal", language: "hinglish" }, [fake("recorded", false, log), fake("browser", true, log)])).provider).toBe("browser");
    const none = await speak({ text: "PadhoAI ₹599 kal", language: "hinglish" }, [fake("recorded", false, log), fake("browser", false, log)]);
    expect(none).toMatchObject({ provider: "text", reason: "no_indian_voice" });
  });

  it("never speaks personal data or masking tokens", async () => {
    const log: string[] = [];
    const providers = [fake("browser", true, log)];
    expect(await speak({ text: "Aapka number 9876543210 hai", language: "hinglish" }, providers)).toMatchObject({ provider: "text", reason: "pii" });
    expect(await speak({ text: "Hello <NAME_1>", language: "en" }, providers)).toMatchObject({ provider: "text", reason: "pii" });
    expect(await speak({ text: "Sunita ji, kal ₹599 katega", language: "hinglish", names: ["Sunita Verma"] }, providers)).toMatchObject({ provider: "text", reason: "pii" });
    expect(log).toEqual([]);
    expect(speakable({ text: "PadhoAI ka ₹599 kal 9:30 PM ke baad katega. 1930 pe call karein." })).toBe(true);
  });
});

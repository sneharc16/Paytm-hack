import { describe, expect, it } from "vitest";
import { factcheckAlert, factcheckReminder } from "@/llm/factcheck";

const facts = {
  language: "hinglish", kind: "ask", brand: "PadhoAI", registered_name: "Vidyakosh Learning Pvt Ltd", brand_verified: true,
  amount_rupees: 599, trial_amount_rupees: 1, trial_date: "18 Oct", charge_day: "Kal", charge_time_text: "9:30 PM ke baad",
  usage: "not_opened", choices: ["keep", "skip", "pause", "cancel"], skip_is_merchant_offer: true, no_answer_outcome: "not_charged",
};
const good = {
  title: "Kal ₹599 PadhoAI ko jaayenge", language: "hinglish",
  body: "18 Oct ko ₹1 ka trial liya tha. Chalne dein, skip karein, pause ya band karein.",
  voice_script: "Kal 9:30 PM ke baad PadhoAI ke liye ₹599 katenge. Bank SMS mein Vidyakosh Learning Pvt Ltd aayega.",
};

describe("L1 fact-check (PRD 14.3, test 6)", () => {
  it("passes a faithful reminder", () => expect(factcheckReminder(facts, good)).toEqual([]));
  it("rejects a wrong amount (RT-05)", () => {
    expect(factcheckReminder(facts, { ...good, title: "Kal ₹699 PadhoAI ko jaayenge" })).toEqual(expect.arrayContaining(["title_missing_amount", "unknown_numbers:699"]));
  });
  it("rejects an extra date", () => {
    expect(factcheckReminder(facts, { ...good, body: "25 Oct tak jawab dein." }).join()).toContain("unknown_numbers:25");
  });
  it("rejects a banned word", () => {
    expect(factcheckReminder(facts, { ...good, body: "Ye ek scam ho sakta hai." }).join()).toContain("banned:scam");
  });
  it("rejects the wrong script", () => {
    expect(factcheckReminder({ ...facts, language: "hi" }, { ...good, language: "hi" })).toContain("script_not_devanagari");
    expect(factcheckReminder(facts, { ...good, body: "कल पैसा कटेगा" })).toContain("script_not_latin");
  });
  it("rejects text that is too long", () => {
    expect(factcheckReminder(facts, { ...good, body: "a".repeat(161) })).toContain("too_long");
  });
  it("reads Devanagari digits", () => {
    expect(factcheckReminder({ ...facts, language: "hi" }, { title: "कल ₹599 PadhoAI को जाएंगे", body: "७०० रुपये", voice_script: "कल रात पैसा कटेगा", language: "hi" }).join()).toContain("unknown_numbers:700");
  });
});

describe("L6 fact-check", () => {
  const m = { brand: "PadhoAI", count: 46, consent: 38, name: 6, ownership: 2, trial_amount: "₹1", amount: "₹599" };
  it("needs the privacy line and only the given numbers", () => {
    expect(factcheckAlert(m, { headline: "46 reviews mention your ₹1 trial", detail: "Only you and Paytm's merchant team can see this. 38 didn't expect ₹599." })).toEqual([]);
    expect(factcheckAlert(m, { headline: "50 reviews", detail: "Bad merchant." })).toEqual(["unknown_numbers:50", "missing_privacy_line"]);
  });
});

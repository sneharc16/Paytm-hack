// Which Gemini model writes Sunita's Hindi reminder correctly? Usage: TRY_MODELS=a,b,c pnpm try:hindi
import { runTask } from "@/llm/client";
import { factcheckReminder } from "@/llm/factcheck";

const facts = {
  language: "hi", kind: "ask", brand: "PadhoAI", registered_name: "Vidyakosh Learning Pvt Ltd", brand_verified: true,
  amount_rupees: 599, amount_text: "₹599", trial_amount_rupees: 1, trial_amount_text: "₹1", trial_date: "18 अक्टूबर",
  charge_day: "कल", charge_time_text: "9:30 PM के बाद", usage: "not_opened", choices: ["keep", "skip", "pause", "cancel"],
  skip_is_merchant_offer: true, no_answer_outcome: "not_charged",
};

async function main() {
  for (const model of (process.env.TRY_MODELS ?? "").split(",").filter(Boolean)) {
    // Same model for both tiers, so a busy answer is not silently retried on another model.
    process.env.GEMINI_MODEL = model;
    process.env.GEMINI_MODEL_FAST = model;
    const t = Date.now();
    const r = await runTask("reminder", { ...facts, _probe: model }, { useDemoCache: false });
    if (!r.ok) { console.log(`${model}: FAILED ${r.reason} (${Date.now() - t} ms)`); continue; }
    const out = r.output as { title: string; body: string; voice_script: string; language: string };
    const fails = factcheckReminder(facts, out);
    console.log(`${model}: ${fails.length ? "fact-check FAILED " + fails.join(", ") : "PASSES"} (${Date.now() - t} ms)\n  ${out.title}\n  ${out.body}`);
  }
}
main();

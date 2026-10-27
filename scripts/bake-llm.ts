// Bake the demo cache: run the whole demo story once, record every model input it needs (reminders, review
// tags, case summaries, merchant alerts), ask the model once per unique input, and save to src/llm/demo-cache.json.
// Usage: LLM_API_KEY=... pnpm bake:llm      (add --dry-run to only count the inputs)
import { writeFileSync } from "node:fs";
import { setSummarizer } from "@/engine/actions";
import { tick } from "@/engine/agent";
import { DEMO_END } from "@/engine/clock";
import { setWriter, type ReminderFacts } from "@/engine/explain";
import { setAlertWriter, setTagger } from "@/engine/radar";
import { Session } from "@/engine/session";
import { generateWorld } from "@/engine/world";
import { cacheKey, type CacheEntry } from "@/llm/cache";
import { llmEnabled, runTask } from "@/llm/client";
import { factcheckReminder } from "@/llm/factcheck";
import { reminderInput } from "@/llm/hooks";
import { PROMPTS, type Task } from "@/llm/prompts";

const inputs = new Map<string, { task: Task; input: unknown; facts?: ReminderFacts }>();
const record = (task: Task, input: unknown, facts?: ReminderFacts) => inputs.set(cacheKey(task, input), { task, input, facts });

setWriter((facts, tpl) => { record("reminder", reminderInput(facts), facts); return tpl; });
setTagger((r) => { record("tagger", { text: r.text }); return { gap: r.goldGap ?? "other", confidence: 1, evidence: "", modelVersion: "seed-labels" }; });
setSummarizer((facts, tpl) => { record("case_summary", facts); return tpl; });
setAlertWriter((metrics, tpl) => { record("alert", metrics); return tpl; });

const world = generateWorld("2711");
tick(new Session("BAKE", world), DEMO_END);
// Every low-star review, so the Review Radar page shows model tags too.
for (const r of world.reviews) if (r.rating <= 2) record("tagger", { text: r.text });

const counts: Record<string, number> = {};
for (const x of inputs.values()) counts[x.task] = (counts[x.task] ?? 0) + 1;
console.log("Inputs to bake:", counts);
if (process.argv.includes("--dry-run")) process.exit(0);
if (!llmEnabled()) {
  console.error("No model key. Set LLM_API_KEY (or ANTHROPIC_API_KEY) and LLM_PROVIDER=anthropic, then run again.");
  process.exit(1);
}

async function main() {
  const entries: Record<string, CacheEntry> = {};
  const failed: Record<string, number> = {};
  const queue = [...inputs.entries()];
  let done = 0;
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [key, { task, input, facts }] = next;
      const r = await runTask(task, input, { useDemoCache: false });
      done++;
      if (!r.ok) { failed[r.reason] = (failed[r.reason] ?? 0) + 1; continue; }
      if (task === "reminder" && facts) {
        const fails = factcheckReminder(facts, r.output as Parameters<typeof factcheckReminder>[1]);
        if (fails.length) { failed[`factcheck:${fails[0].split(":")[0]}`] = (failed[`factcheck:${fails[0].split(":")[0]}`] ?? 0) + 1; }
      }
      entries[key] = { task, model: r.model, promptVersion: PROMPTS[task].version, input, output: r.output, createdAt: new Date().toISOString() };
      if (done % 25 === 0) console.log(`${done}/${inputs.size}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  writeFileSync("src/llm/demo-cache.json", JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 1) + "\n");
  console.log(`Saved ${Object.keys(entries).length} entries. Failures (templates will be used):`, failed);
}

main().catch((e) => { console.error(e); process.exit(1); });

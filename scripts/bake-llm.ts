// Bake the demo cache: run the whole demo story once, record every model input it needs (reminders, review
// tags, case summaries, merchant alerts), ask the model once per unique input, and save to src/llm/demo-cache.json.
// Usage: LLM_API_KEY=... pnpm bake:llm      (add --dry-run to only count the inputs)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setSummarizer } from "@/engine/actions";
import { tick } from "@/engine/agent";
import { DEMO_END } from "@/engine/clock";
import { setWriter, type ReminderFacts } from "@/engine/explain";
import { setAlertWriter, setTagger } from "@/engine/radar";
import { Session } from "@/engine/session";
import { generateWorld } from "@/engine/world";
import { cacheKey, type CacheEntry } from "@/llm/cache";
import { llmEnabled, provider, runTask } from "@/llm/client";
import { factcheckReminder } from "@/llm/factcheck";
import { MODEL_KINDS, reminderInput } from "@/llm/hooks";
import { PROMPTS, type Task } from "@/llm/prompts";

const inputs = new Map<string, { task: Task; input: unknown; facts?: ReminderFacts }>();
const record = (task: Task, input: unknown, facts?: ReminderFacts) => inputs.set(cacheKey(task, input), { task, input, facts });

setWriter((facts, tpl) => { if (MODEL_KINDS.has(facts.kind)) record("reminder", reminderInput(facts), facts); return tpl; });
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
  console.error("No model key. Set GEMINI_API_KEY (free) or LLM_API_KEY (Anthropic) in .env.local, then run again.");
  process.exit(1);
}

const CACHE_FILE = "src/llm/demo-cache.json";

async function main() {
  // Resumable: keep what earlier runs baked and save as we go, so a stop or crash loses at most a few texts.
  const previous = existsSync(CACHE_FILE) ? (JSON.parse(readFileSync(CACHE_FILE, "utf8")).entries ?? {}) : {};
  // BAKE_REDO_FAILED=1 asks again only for reminders that fail the fact-check (for example after changing models).
  const redo = process.env.BAKE_REDO_FAILED === "1";
  const failsCheck = (e: CacheEntry) => e.task === "reminder" && factcheckReminder(e.input as Parameters<typeof factcheckReminder>[0], e.output as Parameters<typeof factcheckReminder>[1]).length > 0;
  const entries: Record<string, CacheEntry> = Object.fromEntries(Object.entries(previous as Record<string, CacheEntry>).filter(([k, e]) => inputs.has(k) && !(redo && failsCheck(e))));
  const save = () => writeFileSync(CACHE_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 1) + "\n");
  console.log(`Already baked: ${Object.keys(entries).length}`);
  const failed: Record<string, number> = {};
  const queue = [...inputs.entries()].filter(([k]) => !entries[k]);
  let done = 0;
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [key, { task, input, facts }] = next;
      // Free tiers allow only a few requests a minute: back off and retry on rate limits.
    let r = await runTask(task, input, { useDemoCache: false });
    for (let wait = 20_000; !r.ok && ["rate_limited", "api_503", "api_504", "timeout"].includes(r.reason) && wait <= 160_000; wait *= 2) {
      await new Promise((ok) => setTimeout(ok, wait));
      r = await runTask(task, input, { useDemoCache: false });
    }
      done++;
      if (!r.ok) { failed[r.reason] = (failed[r.reason] ?? 0) + 1; continue; }
      if (task === "reminder" && facts) {
        const fails = factcheckReminder(facts, r.output as Parameters<typeof factcheckReminder>[1]);
        if (fails.length) { failed[`factcheck:${fails[0].split(":")[0]}`] = (failed[`factcheck:${fails[0].split(":")[0]}`] ?? 0) + 1; }
      }
      entries[key] = { task, model: r.model, promptVersion: PROMPTS[task].version, input, output: r.output, createdAt: new Date().toISOString() };
      if (done % 10 === 0) { save(); console.log(`${Object.keys(entries).length}/${inputs.size} saved`); }
    }
  }
  const workers = Number(process.env.BAKE_CONCURRENCY) || (provider() === "gemini" ? 2 : 6);
  console.log(`Baking with ${provider()}, ${workers} at a time`);
  await Promise.all(Array.from({ length: workers }, worker));
  save();
  console.log(`Saved ${Object.keys(entries).length} entries. Failures (templates will be used):`, failed);
}

main().catch((e) => { console.error(e); process.exit(1); });

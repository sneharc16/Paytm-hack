// Bake the demo cache: run the whole demo story once, record every model input it needs (reminders, review
// tags, case summaries, merchant alerts), ask the model once per unique input, and save to src/llm/demo-cache.json.
// Inputs are masked first and stored masked; texts people read go through the three-agent review loop, and
// the cache keeps the final text, its status and the review trail (templates included).
// Usage: pnpm bake:llm      (add --dry-run to only count the inputs)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setSummarizer } from "@/engine/actions";
import { tick } from "@/engine/agent";
import { DEMO_END } from "@/engine/clock";
import { setWriter } from "@/engine/explain";
import { setAlertWriter, setTagger } from "@/engine/radar";
import { Session } from "@/engine/session";
import { generateWorld } from "@/engine/world";
import { mask } from "@/lib/privacy/mask";
import { cacheKey, versionFor, type CacheEntry } from "@/llm/cache";
import { llmEnabled, provider, runTask } from "@/llm/client";
import { MODEL_KINDS } from "@/llm/hooks";
import { alertInput, reminderInput, summaryInput, tagInput, type ModelInput } from "@/llm/inputs";

const inputs = new Map<string, ModelInput & { masked: unknown }>();
const record = (m: ModelInput) => { const { masked } = mask(m.input, m.mask); inputs.set(cacheKey(m.task, masked), { ...m, masked }); };

setWriter((facts, tpl) => { if (MODEL_KINDS.has(facts.kind)) record(reminderInput(facts)); return tpl; });
setTagger((r) => { record(tagInput(r.text)); return { gap: r.goldGap ?? "other", confidence: 1, evidence: "", modelVersion: "seed-labels" }; });
setSummarizer((facts, tpl, ctx) => { record(summaryInput(facts, ctx.names)); return tpl; });
setAlertWriter((metrics, tpl) => { record(alertInput(metrics)); return tpl; });

const world = generateWorld("2711");
tick(new Session("BAKE", world), DEMO_END);
// Every low-star review, so the Review Radar page shows model tags too.
for (const r of world.reviews) if (r.rating <= 2) record(tagInput(r.text));

const counts: Record<string, number> = {};
for (const x of inputs.values()) counts[x.task] = (counts[x.task] ?? 0) + 1;
console.log("Inputs to bake:", counts);
if (process.argv.includes("--dry-run")) process.exit(0);
if (!llmEnabled()) {
  console.error("No model key. Set GEMINI_API_KEY (free) or LLM_API_KEY (Anthropic) in .env.local, then run again.");
  process.exit(1);
}

const CACHE_FILE = "src/llm/demo-cache.json";
const TRANSIENT = /rate_limited|api_503|api_504|timeout|connection/;

async function main() {
  // Resumable: keep what earlier runs baked and save as we go, so a stop or crash loses at most a few texts.
  // Entries from older prompt versions have other keys and drop out here.
  const previous = existsSync(CACHE_FILE) ? (JSON.parse(readFileSync(CACHE_FILE, "utf8")).entries ?? {}) : {};
  // BAKE_REDO_FAILED=1 asks again for texts whose review ended in the template.
  const redo = process.env.BAKE_REDO_FAILED === "1";
  const entries: Record<string, CacheEntry> = Object.fromEntries(Object.entries(previous as Record<string, CacheEntry>).filter(([k, e]) => inputs.has(k) && !(redo && e.output === null)));
  const save = () => writeFileSync(CACHE_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 1) + "\n");
  console.log(`Already baked: ${Object.keys(entries).length}`);
  const outcome: Record<string, number> = {};
  const queue = [...inputs.entries()].filter(([k]) => !entries[k]);
  let done = 0;
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [key, m] = next;
      // Free tiers allow only a few requests a minute: back off and retry on rate limits.
      let r = await runTask(m.task, m.input, { useDemoCache: false, mask: m.mask, keepMasked: true });
      const transient = () => !r.ok && TRANSIENT.test(r.reason);
      for (let wait = 20_000; transient() && wait <= 160_000; wait *= 2) {
        await new Promise((ok) => setTimeout(ok, wait));
        r = await runTask(m.task, m.input, { useDemoCache: false, mask: m.mask, keepMasked: true });
      }
      done++;
      const label = r.ok ? (r.review?.status ?? "ok") : r.review ? `template (${r.review.reason?.split(":")[0]})` : `failed (${r.reason})`;
      outcome[`${m.task}: ${label}`] = (outcome[`${m.task}: ${label}`] ?? 0) + 1;
      // Keep reviewed outcomes, templates included; a transient failure is asked again next run.
      if (r.ok) entries[key] = { task: m.task, model: r.model, promptVersion: versionFor(m.task), input: m.masked, output: r.output, createdAt: new Date().toISOString(), review: r.review };
      else if (r.review && !TRANSIENT.test(r.review.reason ?? "") && r.review.reason !== "time_budget") entries[key] = { task: m.task, model: r.review.models.generator ?? "", promptVersion: versionFor(m.task), input: m.masked, output: null, createdAt: new Date().toISOString(), review: r.review };
      if (done % 5 === 0) { save(); console.log(`${Object.keys(entries).length}/${inputs.size} saved`, outcome); }
    }
  }
  const workers = Number(process.env.BAKE_CONCURRENCY) || (provider() === "gemini" ? 2 : 6);
  console.log(`Baking with ${provider()}, ${workers} at a time`);
  await Promise.all(Array.from({ length: workers }, worker));
  save();
  console.log(`Saved ${Object.keys(entries).length} entries.`, outcome);
}

main().catch((e) => { console.error(e); process.exit(1); });

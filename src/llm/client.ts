// src/llm/client.ts: the one place that calls a language model (PRD 14.2). Server only: it reads the API key.
// Order: demo cache, then this process's cache, then the model. Every output is schema-validated; anything
// that fails (no key, timeout, refusal, bad JSON) returns { ok: false } and the caller uses its template.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { cacheKey, lookup } from "./cache";
import { PROMPTS, type Task } from "./prompts";
import { SCHEMAS } from "./schemas";

export type TaskResult =
  | { ok: true; output: unknown; model: string; promptVersion: string; cacheHit: boolean; latencyMs: number }
  | { ok: false; reason: string; promptVersion: string };

const memory = new Map<string, { output: unknown; model: string }>();

/** Writing tasks use the main model; tagging, intake and lint use the fast one. */
export function modelFor(task: Task): string {
  const main = process.env.LLM_MODEL || "claude-sonnet-5-5";
  const fast = process.env.LLM_MODEL_FAST || "claude-haiku-5-5";
  return task === "tagger" || task === "intake" || task === "lint" ? fast : main;
}

export function llmEnabled(): boolean {
  return (process.env.LLM_PROVIDER ?? "anthropic") === "anthropic" && !!(process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // 6 second timeout, one retry (PRD 14.2).
  client ??= new Anthropic({ apiKey: process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY, timeout: 6000, maxRetries: 1 });
  return client;
}
/** Tests swap in a fake. */
export function setClientForTests(c: unknown) { client = c as Anthropic; }

function userContent(task: Task, input: unknown): string {
  const json = JSON.stringify(input);
  switch (task) {
    case "reminder": return `FACTS:\n${json}`;
    case "tagger": return `Review:\n${(input as { text: string }).text}`;
    case "intake": return `Message:\n${(input as { text: string }).text}`;
    case "case_summary": return `FACTS:\n${json}`;
    case "lint": return `TEXT:\n${(input as { text: string }).text}`;
    case "alert": return `METRICS:\n${json}`;
  }
}

export async function runTask(task: Task, input: unknown, opts: { useDemoCache?: boolean } = {}): Promise<TaskResult> {
  const promptVersion = PROMPTS[task].version;
  if (opts.useDemoCache ?? process.env.LLM_USE_DEMO_CACHE !== "false") {
    const hit = lookup(task, input);
    if (hit) return { ok: true, output: hit.output, model: hit.model, promptVersion, cacheHit: true, latencyMs: 0 };
  }
  const key = cacheKey(task, input);
  const mem = memory.get(key);
  if (mem) return { ok: true, output: mem.output, model: mem.model, promptVersion, cacheHit: true, latencyMs: 0 };
  if (!llmEnabled() && !client) return { ok: false, reason: "llm_off", promptVersion };

  const model = modelFor(task);
  const started = Date.now();
  try {
    const response = await getClient().beta.messages.parse({
      model,
      max_tokens: 2000,
      system: PROMPTS[task].system,
      messages: [{ role: "user", content: userContent(task, input) }],
      output_config: { effort: "low", format: betaZodOutputFormat(SCHEMAS[task]) },
      // Refusals on the Sonnet route fall back server-side; the Haiku route has no fallback and uses the template.
      ...(model.startsWith("claude-sonnet") ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const latencyMs = Date.now() - started;
    if (response.stop_reason === "refusal") return { ok: false, reason: "refusal", promptVersion };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "max_tokens", promptVersion };
    const parsed = SCHEMAS[task].safeParse(response.parsed_output);
    if (!parsed.success) return { ok: false, reason: "invalid_output", promptVersion };
    memory.set(key, { output: parsed.data, model: response.model });
    console.info(JSON.stringify({ llm: task, model: response.model, promptVersion, latencyMs, cacheHit: false }));
    return { ok: true, output: parsed.data, model: response.model, promptVersion, cacheHit: false, latencyMs };
  } catch (error) {
    const reason =
      error instanceof Anthropic.RateLimitError ? "rate_limited"
      : error instanceof Anthropic.AuthenticationError ? "auth"
      : error instanceof Anthropic.BadRequestError ? "bad_request"
      : error instanceof Anthropic.APIConnectionTimeoutError ? "timeout"
      : error instanceof Anthropic.APIConnectionError ? "connection"
      : error instanceof Anthropic.APIError ? `api_${error.status}`
      : "error";
    console.warn(JSON.stringify({ llm: task, model, promptVersion, fallback: reason }));
    return { ok: false, reason, promptVersion };
  }
}

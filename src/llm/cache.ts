// Demo cache: model outputs baked ahead of time (scripts/bake-llm.ts), so the stage demo needs no network.
// Keyed by task, prompt version and input; the entry records which model wrote it.
import { sha256 } from "@/lib/hash";
import demo from "./demo-cache.json";
import type { ReviewMeta } from "./agents/loop";
import { reviewVersion } from "./agents/prompts";
import { isReviewed } from "./agents/rubric";
import { PROMPTS, type Task } from "./prompts";

/** input and output are masked (tokens, never personal values). Reviewed tasks carry the review trail; their
 *  output is null when the review ended in the template. */
export interface CacheEntry { task: Task; model: string; promptVersion: string; input: unknown; output: unknown; createdAt: string; review?: ReviewMeta }

/** The version a task's output depends on: the task prompt, plus the agents and rubric for reviewed tasks. */
export const versionFor = (task: Task) => (isReviewed(task) ? reviewVersion(task) : PROMPTS[task].version);

/** JSON with sorted keys, so the same input always gives the same key. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Keyed by task, every prompt version and the masked input. */
export const cacheKey = (task: Task, maskedInput: unknown) => sha256(`${task}|${versionFor(task)}|${stableJson(maskedInput)}`);

const entries = (demo as { entries?: Record<string, CacheEntry> }).entries ?? {};

export function lookup(task: Task, maskedInput: unknown): CacheEntry | undefined {
  return entries[cacheKey(task, maskedInput)];
}

export const demoCacheSize = () => Object.keys(entries).length;

export const entryByKey = (key: string): CacheEntry | undefined => entries[key];

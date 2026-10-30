// POST /api/llm/{task}: one model task with cache and fallback (PRD 27). Rate limited per session.
// Inputs are masked inside runTask; this route builds them on the server from our own data, so the browser
// sends only the customer's text. The answer carries the review status and masked counts, never values.
import { z } from "zod";
import { generateWorld } from "@/engine/world";
import type { ReviewStamp, World } from "@/engine/types";
import { runTask } from "@/llm/client";
import { intakeInput, lintInput, type ModelInput } from "@/llm/inputs";
import { TASKS, type Task } from "@/llm/prompts";

const LIMIT = 30; // calls per minute per session (PRD 30.5)
const BUDGET_MS = 12_000; // a person is waiting: the whole review loop gets this long
const hits = new Map<string, number[]>();
let world: World | null = null;

const Body = z.object({
  session: z.string().max(40).default("anon"),
  input: z.object({ text: z.string().min(1).max(300) }),
  userId: z.string().max(20).optional(),
  lang: z.enum(["hi", "hinglish", "en"]).default("hinglish"),
});

function modelInput(task: Task, body: z.infer<typeof Body>): ModelInput | null {
  if (task === "lint") return lintInput(body.input.text);
  if (task === "intake" && body.userId) return intakeInput((world ??= generateWorld("2711")), body.userId, body.input.text, body.lang);
  return null;
}

export async function POST(req: Request, ctx: RouteContext<"/api/llm/[task]">) {
  const { task } = await ctx.params;
  if (!TASKS.includes(task as Task)) return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown task" } }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, { status: 400 });
  const m = modelInput(task as Task, parsed.data);
  if (!m) return Response.json({ ok: false, error: { code: "NOT_LIVE", message: "This task is not called live" } }, { status: 400 });
  const now = Date.now();
  const recent = (hits.get(parsed.data.session) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= LIMIT) return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many model calls this minute" } }, { status: 429 });
  hits.set(parsed.data.session, [...recent, now]);
  const r = await runTask(m.task, m.input, { mask: m.mask, timeoutMs: BUDGET_MS, budgetMs: BUDGET_MS });
  const review: ReviewStamp | undefined = r.review && {
    status: r.review.status, rounds: r.review.rounds, ...(r.review.reason ? { reason: r.review.reason.slice(0, 200) } : {}),
    trail: r.review.trail.map((t) => ({ round: t.round, verdicts: t.verdicts })), masked: r.masked,
  };
  return Response.json({ ok: true, data: r.ok ? { output: r.output, model: r.model, promptVersion: r.promptVersion, cacheHit: r.cacheHit, review, masked: r.masked } : { fallback: r.reason, promptVersion: r.promptVersion, review, masked: r.masked } });
}

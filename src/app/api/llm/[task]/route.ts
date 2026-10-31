// POST /api/llm/{task}: one model task with cache and fallback (PRD 27). Rate limited per IP and session.
// Inputs are masked inside runTask; this route builds them on the server from our own data, so the browser
// sends only the customer's text. The answer carries the review status and masked counts, never values.
import { z } from "zod";
import { generateWorld } from "@/engine/world";
import type { ReviewStamp, World } from "@/engine/types";
import { allowedOrigins } from "@/lib/server/b2b/auth";
import { BoundedRateLimiter, checkNonCrossOrigin, clientIp, readBoundedJson } from "@/lib/server/security";
import { runTask } from "@/llm/client";
import { intakeInput, lintInput, type ModelInput } from "@/llm/inputs";
import { TASKS, type Task } from "@/llm/prompts";

const LIMIT = 30; // calls per minute per session (PRD 30.5)
const IP_LIMIT = 60; // hard cap per client IP regardless of session rotation
const BUDGET_MS = 12_000; // a person is waiting: the whole review loop gets this long
const limiter = new BoundedRateLimiter(4096, 60_000);
let world: World | null = null;

const Body = z.object({
  session: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).default("anon"),
  input: z.object({ text: z.string().min(1).max(300) }),
  userId: z.string().regex(/^[A-Za-z0-9_]{1,20}$/).optional(),
  lang: z.enum(["hi", "hinglish", "en"]).default("hinglish"),
});

function modelInput(task: Task, body: z.infer<typeof Body>): ModelInput | null {
  if (task === "lint") return lintInput(body.input.text);
  if (task === "intake" && body.userId) return intakeInput((world ??= generateWorld("2711")), body.userId, body.input.text, body.lang);
  return null;
}

export async function POST(req: Request, ctx: RouteContext<"/api/llm/[task]">) {
  if (!checkNonCrossOrigin(req, allowedOrigins(req))) {
    return Response.json({ ok: false, error: { code: "CROSS_ORIGIN", message: "Cross-origin request blocked" } }, { status: 403 });
  }
  const { task } = await ctx.params;
  if (!TASKS.includes(task as Task)) return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown task" } }, { status: 404 });
  const j = await readBoundedJson(req, 16 * 1024);
  const parsed = j ? Body.safeParse(j.body) : null;
  if (!parsed?.success) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed?.error.message ?? "Invalid JSON" } }, { status: 400 });
  const m = modelInput(task as Task, parsed.data);
  if (!m) return Response.json({ ok: false, error: { code: "NOT_LIVE", message: "This task is not called live" } }, { status: 400 });
  const ip = clientIp(req);
  if (limiter.limited(`llm-ip:${ip}`, IP_LIMIT) || limiter.limited(`llm-sess:${ip}:${parsed.data.session}`, LIMIT)) {
    return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many model calls this minute" } }, { status: 429 });
  }
  const r = await runTask(m.task, m.input, { mask: m.mask, timeoutMs: BUDGET_MS, budgetMs: BUDGET_MS });
  const review: ReviewStamp | undefined = r.review && {
    status: r.review.status, rounds: r.review.rounds, ...(r.review.reason ? { reason: r.review.reason.slice(0, 200) } : {}),
    trail: r.review.trail.map((t) => ({ round: t.round, verdicts: t.verdicts })), masked: r.masked,
  };
  return Response.json({ ok: true, data: r.ok ? { output: r.output, model: r.model, promptVersion: r.promptVersion, cacheHit: r.cacheHit, review, masked: r.masked } : { fallback: r.reason, promptVersion: r.promptVersion, review, masked: r.masked } });
}

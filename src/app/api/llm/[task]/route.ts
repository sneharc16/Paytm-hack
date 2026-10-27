// POST /api/llm/{task}: one model task with cache and fallback (PRD 27). Rate limited per session.
import { z } from "zod";
import { runTask } from "@/llm/client";
import { TASKS, type Task } from "@/llm/prompts";

const LIMIT = 30; // calls per minute per session (PRD 30.5)
const hits = new Map<string, number[]>();

const Body = z.object({ session: z.string().max(40).default("anon"), input: z.unknown() });

export async function POST(req: Request, ctx: RouteContext<"/api/llm/[task]">) {
  const { task } = await ctx.params;
  if (!TASKS.includes(task as Task)) return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown task" } }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, { status: 400 });
  const now = Date.now();
  const recent = (hits.get(parsed.data.session) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= LIMIT) return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many model calls this minute" } }, { status: 429 });
  hits.set(parsed.data.session, [...recent, now]);
  const r = await runTask(task as Task, parsed.data.input);
  return Response.json({ ok: true, data: r.ok ? { output: r.output, model: r.model, promptVersion: r.promptVersion, cacheHit: r.cacheHit } : { fallback: r.reason, promptVersion: r.promptVersion } });
}

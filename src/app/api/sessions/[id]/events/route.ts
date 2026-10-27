import { Command } from "@/engine/commands";
import { command, eventsSince } from "@/lib/server/sessions";

const SESSION_ID = /^[A-Z0-9-]{3,24}$/;

/** Catch-up and polling: events after an id, plus the clock. Advances the session to sim now first. */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]/events">) {
  const { id } = await ctx.params;
  if (!SESSION_ID.test(id)) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: "Bad session id" } }, { status: 400 });
  const url = new URL(req.url);
  const after = Number(url.searchParams.get("after") ?? 0);
  const epoch = Number(url.searchParams.get("epoch") ?? 0);
  return Response.json({ ok: true, data: await eventsSince(id, after, epoch) });
}

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/events">) {
  const { id } = await ctx.params;
  if (!SESSION_ID.test(id)) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: "Bad session id" } }, { status: 400 });
  const parsed = Command.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, { status: 400 });
  return Response.json({ ok: true, data: (await command(id, parsed.data)) ?? null });
}

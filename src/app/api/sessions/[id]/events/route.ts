import { Command } from "@/engine/commands";
import { advance, command, getEntry } from "@/lib/server/sessions";

/** Catch-up and polling: events after an id, plus the clock. Advances the session to sim now first. */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]/events">) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const after = Number(url.searchParams.get("after") ?? 0);
  const epoch = Number(url.searchParams.get("epoch") ?? 0);
  const e = getEntry(id);
  advance(e);
  const from = epoch === e.epoch ? after : 0;
  const events = e.session.events.filter((x) => x.id > from);
  return Response.json({ ok: true, data: { epoch: e.epoch, clock: e.clock, events, invariantFailures: e.invariantFailures } });
}

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/events">) {
  const { id } = await ctx.params;
  const parsed = Command.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, { status: 400 });
  return Response.json({ ok: true, data: command(id, parsed.data) ?? null });
}

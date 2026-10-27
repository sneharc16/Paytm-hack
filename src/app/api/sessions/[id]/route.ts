import { advance, getEntry } from "@/lib/server/sessions";

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  const e = getEntry(id);
  advance(e);
  return Response.json({ ok: true, data: { id, seed: e.session.world.seed, clock: e.clock, epoch: e.epoch } });
}

import { getSession } from "@/lib/server/sessions";

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  return Response.json({ ok: true, data: await getSession(id) });
}

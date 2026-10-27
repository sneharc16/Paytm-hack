import { ClockCommand } from "@/engine/commands";
import { clockCommand } from "@/lib/server/sessions";

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/clock">) {
  const { id } = await ctx.params;
  const parsed = ClockCommand.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, { status: 400 });
  return Response.json({ ok: true, data: clockCommand(id, parsed.data) });
}

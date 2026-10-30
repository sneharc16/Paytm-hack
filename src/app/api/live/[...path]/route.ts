// Pakka live API. See src/lib/server/live/handlers.ts.
import * as h from "@/lib/server/live/handlers";

const notFound = () => Response.json({ ok: false, error: { code: "NOT_FOUND", message: "NOT_FOUND" } }, { status: 404 });

const GETS: Record<string, (req: Request) => Promise<Response>> = { state: h.state, cron: h.cron };
const POSTS: Record<string, (req: Request) => Promise<Response>> = {
  "signup/options": h.signUpOptions, "signup/finish": h.signUpFinish,
  "signin/options": h.signInOptions, "signin/finish": h.signInFinish, signout: h.signOut,
  profile: h.updateProfile, autopays: h.addAutopay, "autopays/remove": h.removeAutopay,
  sms: h.readSms, command: h.command,
};

export async function GET(req: Request, ctx: RouteContext<"/api/live/[...path]">) {
  const fn = GETS[(await ctx.params).path.join("/")];
  return fn ? fn(req) : notFound();
}
export async function POST(req: Request, ctx: RouteContext<"/api/live/[...path]">) {
  const fn = POSTS[(await ctx.params).path.join("/")];
  return fn ? fn(req) : notFound();
}

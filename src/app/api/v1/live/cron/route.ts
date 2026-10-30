import { cron } from "@/lib/server/b2b/handlers";

export const GET = (req: Request) => cron(req);
export const POST = (req: Request) => cron(req);

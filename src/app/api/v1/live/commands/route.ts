import { command } from "@/lib/server/b2b/handlers";

export const POST = (req: Request) => command(req);

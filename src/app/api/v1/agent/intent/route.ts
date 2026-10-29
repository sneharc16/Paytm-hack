import { agentIntent } from "@/lib/server/b2b/handlers";

export const GET = (req: Request) => agentIntent(req);

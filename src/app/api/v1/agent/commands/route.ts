import { agentCommandRoute } from "@/lib/server/b2b/handlers";

export const POST = (req: Request) => agentCommandRoute(req);

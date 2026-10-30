import { agentWork } from "@/lib/server/b2b/handlers";

export const GET = (req: Request) => agentWork(req);

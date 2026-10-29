import { agentMe } from "@/lib/server/b2b/handlers";

export const GET = (req: Request) => agentMe(req);

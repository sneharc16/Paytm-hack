import { listenRoute } from "@/lib/server/voice";

export const POST = (req: Request) => listenRoute(req);

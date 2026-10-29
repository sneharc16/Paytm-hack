import { speakRoute } from "@/lib/server/voice";

export const POST = (req: Request) => speakRoute(req);

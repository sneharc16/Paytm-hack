import { okJson } from "@/lib/server/b2b/http";
import { webhookPublicKey } from "@/lib/server/b2b/webhooks";

/** Public: the key agents use to check that a webhook really came from this server. */
export const GET = () => okJson({ publicKey: webhookPublicKey(), message: "PAKKA_B2B_WEBHOOK_V1|<timestamp>|<sha256 of body>" });

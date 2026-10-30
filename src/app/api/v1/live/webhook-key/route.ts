import { connection } from "next/server";
import { okJson } from "@/lib/server/b2b/http";
import { webhookPublicKey } from "@/lib/server/b2b/webhooks";

/** Public: the key agents use to check that a webhook really came from this server. Answered at request time:
 *  the key comes from the server secret, which must never be needed (or baked in) at build time. */
export async function GET() {
  await connection();
  return okJson({ publicKey: webhookPublicKey(), message: "PAKKA_B2B_WEBHOOK_V1|<timestamp>|<sha256 of body>" });
}

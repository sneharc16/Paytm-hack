import type { Metadata } from "next";
import LiveConsole from "@/components/business/live/LiveConsole";

export const metadata: Metadata = { title: "Pakka for Business, live", description: "Passkey-signed approvals and API-connected AI agents. Only money is simulated." };

export default function Page() {
  return <LiveConsole />;
}

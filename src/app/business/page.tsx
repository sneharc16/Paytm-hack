import type { Metadata } from "next";
import BusinessConsole from "@/components/business/BusinessConsole";

export const metadata: Metadata = { title: "Pakka for Business", description: "AI pays your vendors. Only a receipt it cannot fake lets money leave." };

export default function Page() {
  return <BusinessConsole />;
}

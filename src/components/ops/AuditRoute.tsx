"use client";
// /ops/audit shows the audit log; /ops/audit?redteam=1 shows the red-team panel (PRD 29.2).
import { useEffect, useState } from "react";
import ControlRoom from "./ControlRoom";

export default function AuditRoute() {
  const [redteam, setRedteam] = useState(false);
  useEffect(() => { setRedteam(new URLSearchParams(window.location.search).get("redteam") === "1"); }, []);
  return <ControlRoom page={redteam ? "redteam" : "audit"} />;
}

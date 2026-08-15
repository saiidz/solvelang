import type { Metadata } from "next";
import ServerAuditApp from "../../server-audit/ServerAuditApp";

export const metadata: Metadata = {
  title: "Server Audit | SolveLang",
  description: "Analyze a redacted, read-only server posture snapshot locally in your browser with deterministic operational and security checks.",
};

export default function ServerAuditPage() {
  return <ServerAuditApp />;
}

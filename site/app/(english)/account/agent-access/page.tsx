import type { Metadata } from "next";
import { AgentAccess } from "@/app/account/agent-access/AgentAccess";

export const metadata: Metadata = {
  title: "Agent Access",
  description: "Delegated agent tokens, top-up mandates, purchase approvals, and the activity log for agents acting on your SolveLang account.",
  robots: { index: false, follow: false },
};

export default function AgentAccessPage() {
  return <AgentAccess />;
}

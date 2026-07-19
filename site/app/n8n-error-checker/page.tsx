import type { Metadata } from "next";
import { PreflightLanding } from "../components/PreflightLanding";
export const metadata: Metadata = { title: "n8n Error Checker — SolveLang", description: "Check n8n workflow exports for missing error paths, disabled safeguards, and risky external calls." };
export default function Page(){return <PreflightLanding eyebrow="n8n error checker" title="Find missing failure paths before users do." description="Check whether external calls, webhooks, and branches have enabled failure handling and deliberate outcomes." bullets={["Disabled error nodes do not count","Respond to Webhook is not an error handler","External-call warnings","Clear remediation guidance"]}/>;}

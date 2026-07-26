import type { Metadata } from "next";
import { PreflightLanding } from "../../components/PreflightLanding";
import { alternatesForRoute } from "../../i18n/seo";
export const metadata: Metadata = { title: "n8n Security Scanner — SolveLang", description: "Scan n8n workflow exports for code execution, credential references, unsafe AI paths, and missing safeguards.", alternates: alternatesForRoute("n8n-security-scanner") };
export default function Page(){return <PreflightLanding eyebrow="n8n security scanner" title="Review risky workflow capabilities before deployment." description="SolveLang highlights code execution, command nodes, credential references, AI actions, and absent review safeguards without reading credential values." bullets={["Code and command risk signals","Credential-reference warnings","AI human-review checks","No credential-value inspection"]}/>;}

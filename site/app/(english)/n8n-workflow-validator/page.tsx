import type { Metadata } from "next";
import { PreflightLanding } from "../../components/PreflightLanding";
import { alternatesForRoute } from "../../i18n/seo";
export const metadata: Metadata = { title: "n8n Workflow Validator", description: "Validate n8n workflow structure, triggers, branches, failure handling, and review gates before deployment.", alternates: alternatesForRoute("n8n-workflow-validator") };
export default function Page(){return <PreflightLanding eyebrow="n8n workflow validator" title="Validate an n8n workflow before it reaches production." description="Upload an exported n8n JSON file and receive an immediate deterministic structural score and risk preview." bullets={["Detect missing or disabled triggers","Find disconnected nodes and unclear endings","Flag missing error handling","Identify AI steps without enabled review gates"]}/>;}

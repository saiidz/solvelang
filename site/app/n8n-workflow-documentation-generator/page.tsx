import type { Metadata } from "next";
import { PreflightLanding } from "../components/PreflightLanding";
export const metadata: Metadata = { title: "n8n Workflow Documentation Generator — SolveLang", description: "Generate readable evidence and remediation guidance from an exported n8n workflow." };
export default function Page(){return <PreflightLanding eyebrow="n8n documentation generator" title="Turn an exported workflow into reviewable evidence." description="Generate a score, structured findings, node references, and downloadable HTML or JSON evidence for handoff and QA." bullets={["Client-ready HTML report","Machine-readable JSON evidence","Severity counts and recommendations","Workflow data remains browser-local during scanning"]}/>;}

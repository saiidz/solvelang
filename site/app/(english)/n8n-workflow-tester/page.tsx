import type { Metadata } from "next";
import { PreflightLanding } from "../../components/PreflightLanding";
import { alternatesForRoute } from "../../i18n/seo";
export const metadata: Metadata = { title: "n8n Workflow Tester — SolveLang", description: "Test exported n8n workflows for structural risks without executing them.", alternates: alternatesForRoute("n8n-workflow-tester") };
export default function Page(){return <PreflightLanding eyebrow="n8n workflow tester" title="Test workflow logic without running production actions." description="SolveLang examines an exported workflow locally and highlights structural conditions that deserve testing before launch." bullets={["No workflow execution","No external API calls","Bounded 2 MB browser scan","Deterministic findings and evidence"]}/>;}

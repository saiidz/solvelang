import type { Metadata } from "next";
import { JsonLd } from "../../../components/JsonLd";
import AutomatedSupportTriageDemo from "./AutomatedSupportTriageDemo";

export const metadata: Metadata = {
  title: "Support Triage Demo",
  description: "Try a local, rule-based support triage preview with proposed ownership, urgency, reply drafts and review boundaries. No inbox connection, external task or message is executed.",
};
const breadcrumb = {
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://www.solve-lang.com/" },
    { "@type": "ListItem", position: 2, name: "Support Triage Demo", item: "https://www.solve-lang.com/demo/support-triage/" },
  ],
};
export default function SupportTriagePage() {
  return <><JsonLd id="support-triage-breadcrumb-json-ld" data={breadcrumb} /><AutomatedSupportTriageDemo /></>;
}

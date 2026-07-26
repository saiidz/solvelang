import legalContent from "./legal-content.json" with { type: "json" };

type LegalSections = readonly (readonly [string, readonly string[]])[];

export const TERMS_VERSION = legalContent.termsVersion;
export const LEGAL_CONTENT = legalContent as unknown as { termsVersion: string; terms: LegalSections; refundPolicy: LegalSections };

function renderDocument(title: string, sections: LegalSections): string {
  return [title, `Version: ${TERMS_VERSION}`, "", ...sections.flatMap(([heading, paragraphs]) => [heading, ...paragraphs, ""])].join("\n").trim();
}

// These exact, versioned public documents are embedded in durable confirmations.
export const CONTRACT_TERMS_TEXT = renderDocument("SolveLang Workflow Preflight Terms of Use", LEGAL_CONTENT.terms);
export const CONTRACT_REFUND_POLICY_TEXT = renderDocument("SolveLang Workflow Preflight Refund Policy", LEGAL_CONTENT.refundPolicy);

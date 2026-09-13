// Dated capability evidence, not a live health feed or authorization to enable a feature.
export const capabilityEvidenceDate = "2026-09-13";
export const accountAvailability = "Production API access and customer-account infrastructure were verified enabled on September 13, 2026. This is deployed infrastructure, not a claim of general managed workflow execution or an availability SLA.";
export const billingAvailability = "API subscription billing is disabled. The displayed API plans are previews, not subscriptions available for purchase. Separate checkout services and live billing require their own verification and approval.";
export const previewAvailability = "The workflow audit and support triage are local, rule-based planning previews. They do not connect an inbox, call an AI model, create remote tasks, or send messages.";

export const capabilityGroups = [
  {
    id: "local", title: "Working locally", description: "Implemented tools you can use without connected production automation.",
    items: [
      "Rust CLI with parsing, validation, diagnostics, imports, data structures, functions, loops, and JSON helpers",
      "Hardened local execution policies for network, file, environment, and AI capabilities",
      "Local-first Workflow Intelligence Studio with deterministic analysis and simulation",
    ],
  },
  {
    id: "preview", title: "Browser previews", description: previewAvailability,
    items: ["Pinned WebAssembly build of the canonical safe core with host side effects denied", "Automatic workflow mapping and support triage examples; proposed actions are not executed"],
  },
  {
    id: "deployed", title: "Deployed, with gates", description: accountAvailability,
    items: ["Public site on AWS Amplify", "Production API/customer-account and authenticator infrastructure; individual features remain gated", "No independently measured uptime or SLA is published"],
  },
  {
    id: "experimental", title: "Experimental", description: "Implementation and tests do not by themselves qualify a provider for production use.",
    items: ["Provider-backed AI and side-effecting HTTP, file, and environment helpers", "Provider adapters and Self-Driving activation require scoped credentials and explicit authorization"],
  },
  {
    id: "disabled", title: "Not enabled for purchase", description: billingAvailability,
    items: ["API subscription checkout and recurring charges remain off", "Paid priority and provider activation are separate rollout gates"],
  },
  {
    id: "planned", title: "Remaining launch work", description: "Not represented as complete or generally available.",
    items: ["Connected inbox-to-action support automation", "General managed workflow execution and broader qualified integrations", "Final release publication, platform evidence, independent monitoring, and operational exercises"],
  },
] as const;

# Studio Privacy and Local Persistence

Workflow Intelligence Studio is local-first. Projects, scenarios, traces, versions, findings, and product-use counters stay in the browser's local storage. Studio contains no workflow network client, external analytics SDK, AI-provider call, server action, or API route.

## Storage model

- Schema version `1` is explicit in every workflow document.
- A dependency-free repository validates stored projects before use.
- An incompatible or malformed collection is quarantined under a separate recovery key and is never silently overwritten. The Projects view can download the raw recovery record or export and reset it after confirmation.
- Project versions are deduplicated and capped at 30 local snapshots.
- Scenario traces are capped by the application to the 50 most recent runs per project.
- Project deletion requires confirmation and exports workflow JSON before local removal.
- Import reads only the file selected by the user and strictly rejects unknown fields, duplicate IDs, unsafe object keys, oversized collections, and broken graph references without modifying the current project.
- Storage access and quota failures are contained and shown as an unavailable-persistence state instead of crashing an edit.

Browser storage is tied to the browser profile and device and has browser-defined capacity limits. Users should export important workflows.

## Runtime boundary

Studio analysis and simulation are deterministic browser tools. They do not execute `.solve` files, call integrations, or prove production safety. Generated scripts are preliminary drafts. The local Rust CLI remains canonical for full syntax validation and execution.

## Hosted migration boundary

A future hosted storage or analytics adapter must be opt-in. Users must see what will leave the device, explicitly choose upload, and retain a local-only mode. Authentication, collaboration, hosted runtime, secrets, billing, and integrations are separate future projects.

# Screenshot and Recording Checklist

Use this list when producing real portfolio media. Do not create placeholder screenshots that imply functionality not present in the captured build.

## Required screenshots

1. **Homepage hero** — positioning and maturity label visible.
2. **Canonical support-triage source** — readable `.solve` file in the repository or editor.
3. **CLI validation success** — `solvec validate` output.
4. **CLI execution result** — support-triage output.
5. **Source-located diagnostic** — one reproducible validation/runtime failure.
6. **Workflow Intelligence Studio** — graph/analysis view with local-first/deterministic context visible.
7. **Browser preview** — code and output, with the safe-subset notice visible.
8. **System status page** — component status and manual-reporting disclosure.
9. **Architecture or repository map** — use Mermaid/documentation if a rendered image is not yet available.

## Optional screenshots

- test-mode API account/key page, clearly labeled experimental/test-mode
- AWS/SAM template diff showing least-privilege IAM work, with secrets redacted
- GitHub PR chain showing incremental development
- business/recruiter documentation landing pages

## Never capture

- API keys, bearer tokens, Stripe secrets, AWS credentials, personal customer data, or environment secrets
- a test-mode account page without explaining that it is test-mode
- a provider response as if it were deterministic output
- an integration mock as if it were a live integration

## 90-second video shot list

1. 0-10s: homepage hero.
2. 10-25s: support-triage source.
3. 25-45s: CLI validate + run.
4. 45-60s: one diagnostic or safety boundary.
5. 60-75s: Studio/browser preview.
6. 75-90s: status labels + GitHub/recruiter CTA.

## 5-minute video shot list

Follow `docs/demo/demo-script.md`. Keep terminal font large enough to read at 1080p. Avoid fast scrolling. Pause after each maturity label.

## Animation guidance

Animations are optional and should explain state changes, not decorate them. Good candidates:
- highlight workflow branch being discussed
- reveal deterministic vs AI-assisted labels
- show a status transition during a documented incident example

Avoid animated claims of integrations or execution that do not exist.

## Expected-output evidence

Before recording, save the exact commit SHA being demonstrated and run the documented commands from that checkout. If expected output changes later, update the demo docs rather than editing a recording to conceal the difference.

## Accessibility

- include captions for recorded demos
- ensure code contrast is readable
- avoid relying on color alone for maturity/status labels
- include alt text or descriptive captions for screenshots used on the website

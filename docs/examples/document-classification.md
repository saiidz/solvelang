# Document Classification

**Primary status:** Experimental AI for semantic classification; deterministic handling of an already-classified document can be represented today.

## Problem

Operations teams receive documents that need to be identified, routed, and reviewed. A model may help classify content, but the downstream handling rules should remain explicit.

## Workflow

```solve
let document = {
  name: "vendor-invoice-1042.pdf",
  classification: "invoice",
  confidence_band: "review"
}

print("Document classification")
print("File: " .. document.name)
print("Class: " .. document.classification)

if document.confidence_band == "review" {
  print("Action: human review required")
} else {
  if document.classification == "invoice" {
    print("Route: accounts payable")
  } else {
    print("Route: general operations")
  }
}
```

## Input

A normalized document record plus a proposed classification. The repository does not claim production OCR, document storage, or a production classifier pipeline.

## Output

```text
Document classification
File: vendor-invoice-1042.pdf
Class: invoice
Action: human review required
```

## Explanation

The example separates semantic interpretation from business policy. A model may propose `invoice`, `contract`, or another label, but the workflow can still require review based on confidence or risk before routing occurs.

## Business value

- makes model uncertainty actionable instead of hidden
- creates explicit human-review policy
- keeps routing logic deterministic
- gives implementation teams a clear contract for future extraction and storage adapters

## Expected result

Given a normalized classification record, the policy should deterministically choose review or routing. The model-generated label itself should be described as experimental and variable.

## Suggested screenshots

1. Classification record and review rule.
2. CLI output showing human review.
3. Studio diagram showing classification followed by a policy gate.
4. A second input with a non-review confidence band showing deterministic routing.

## Suggested demo narration

“The AI can help interpret an unstructured document, but it does not get unlimited authority. SolveLang makes the handoff from uncertain model judgment to deterministic business policy visible.”

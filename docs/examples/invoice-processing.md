# Invoice Processing

**Primary status:** Planned integration with a working deterministic policy core. Document extraction, accounting-system writes, payment actions, and production approvals are not claimed as implemented.

## Problem

Invoice review often combines manual extraction, policy checks, approval thresholds, and accounting-system updates. When these rules are scattered across inboxes and scripts, exceptions become difficult to audit.

## Workflow

Treat extracted invoice data as structured input, then apply explicit policy checks before any external action.

```solve
let invoice = {
  vendor: "Acme Supply",
  amount: 4200,
  purchase_order: true,
  duplicate: false
}

print("Invoice review")
print("Vendor: " .. invoice.vendor)

if invoice.duplicate {
  print("Decision: hold for duplicate review")
} else {
  if invoice.amount > 5000 {
    print("Decision: manager approval required")
  } else {
    if invoice.purchase_order {
      print("Decision: eligible for normal processing")
    } else {
      print("Decision: hold for PO review")
    }
  }
}
```

## Input

```json
{
  "vendor": "Acme Supply",
  "amount": 4200,
  "purchase_order": true,
  "duplicate": false
}
```

## Output

```text
Invoice review
Vendor: Acme Supply
Decision: eligible for normal processing
```

## Explanation

The deterministic approval policy can be expressed and reviewed today. Extracting fields from PDFs, posting to an accounting platform, or triggering payment requires additional verified integrations and should remain outside the claim boundary until implemented.

## Business value

- makes approval thresholds visible
- separates extraction uncertainty from payment policy
- preserves human review for exceptions
- creates an auditable specification before accounting integration work begins

## Expected result

The example should consistently classify a normalized invoice record. It should not be presented as reading a real invoice attachment or paying a vendor.

## Suggested screenshots

1. Invoice policy in source.
2. CLI output for normal processing.
3. A second run with `amount: 7500` showing manager approval.
4. A process diagram with extraction and accounting writes labeled as integration boundaries.

## Suggested demo narration

“The important design decision is that extraction and approval are different concerns. An AI or OCR system may propose invoice fields, but deterministic policy decides whether the invoice can proceed, needs approval, or should be held.”

# Checkout Legal Owner Checklist

This is an owner-only pre-enable checklist for `CHECKOUT_ENABLED=true`. It is not a statement that these items are complete and it is not legal advice.

Do not set `LEGAL_CHECKOUT_REVIEW_VERIFIED=true` until every item below has been completed and independently verified:

- Terms of Use and Refund Policy reviewed for the actual product and jurisdiction.
- `/terms/` and `/refund-policy/` deployed and checked on the production site.
- Checkout clickwrap verified in the production build before Turnstile or PaymentIntent creation.
- UPCOMINGSOUNDS S.R.L. registered office verified for publication where required.
- UPCOMINGSOUNDS S.R.L. company registration number verified.
- CUI/VAT status verified.
- `hello@solve-lang.com` support contact verified for customer requests.
- Applicable consumer-law review completed, including digital-content withdrawal rights and any required pre-contract information.
- Romanian-language Terms, Refund Policy, Privacy, and Withdrawal pages reviewed by the owner and qualified Romanian/EU consumer-law counsel; the repository translation is only a draft.
- Final consumer price and VAT/tax treatment verified for the jurisdictions where checkout will be offered.
- Approved durable contract-confirmation provider configured and independently tested without storing customer email in DynamoDB or PaymentIntent metadata.
- The operator's registered office, phone number, trade-register entry, CUI, and VAT status verified from owner-controlled records before they are published.
- The current ANPC SAL pictogram and official destination verified; do not use the discontinued EU SOL/ODR platform.

Keep the verified details in the owner-controlled legal records. Do not add guessed address, registration, CUI/VAT, or attorney-approval details to the public site or repository.

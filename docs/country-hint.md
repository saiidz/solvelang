# Optional Country Hint

`NEXT_PUBLIC_COUNTRY_HINT_ENDPOINT` is optional. When unset, no request is made and browser language plus English fallback still work. When configured, the browser makes a short, credential-omitting request and accepts only this exact JSON shape:

```json
{ "country": "FR" }
```

The country value must be an uppercase ISO 3166-1 alpha-2 code. Extra fields, lowercase values, malformed JSON, timeouts, and failures are ignored silently. The response must never include raw IP, city, coordinates, postal code, ISP, organization, ASN, timezone, device detail, fingerprint data, email, payment IDs, scan data, workflow data, or entitlement tokens.

The hint is an in-memory weak language-suggestion signal only. It is not persisted, logged, sent to analytics, Stripe, DynamoDB, entitlement requests, or tokens. It never selects law, tax, VAT, currency, price, availability, checkout eligibility, refund eligibility, or contract language. It never forces redirects. Multilingual countries remain English unless a stronger browser-language signal identifies one supported locale.

Possible future owner-approved deployments are a CloudFront/Amplify edge endpoint using `CloudFront-Viewer-Country`, a Cloudflare Worker using `CF-IPCountry`, or another CDN endpoint that returns only the country field. Do not deploy one, add a geolocation provider, add an API key, use browser geolocation, or add precise location collection without a separate reviewed change.

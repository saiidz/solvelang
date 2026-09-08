# Self-Driving GitHub private-key signer boundary

This document records the repository-safe signer boundary that sits behind the merged GitHub installation runtime gate and installation-token mint provider.

## Purpose

GitHub App installation-token minting requires an RS256-signed App JWT. This boundary defines how an approved isolated runtime may satisfy that signature request without making raw private-key material available to SolveLang product code, browser code, environment fallback logic, or returned artifacts.

## Binding

`createSelfDrivingGitHubPrivateKeySignerBinding` recreates the canonical installation activation from the exact PR-write execution plan and binds:

- the exact execution plan and activation IDs;
- repository and GitHub App installation identity;
- GitHub App issuer;
- an opaque non-secret key reference;
- an exact SHA-256 public-key fingerprint;
- the activation `notBefore` / `expiresAt` window.

The binding ID is SHA-256 over those canonical fields. Signer construction does not trust that unkeyed ID as authenticity by itself: it recreates the binding again from the supplied exact plan and activation and exact-compares the complete artifact before any key lease can be requested.

## Secret isolation

The injected lease provider does **not** return PEM/private-key bytes. It returns only bounded non-secret lease evidence plus one `signRs256` capability:

- exact key reference;
- exact public-key SHA-256 fingerprint;
- `RS256` algorithm;
- lease ID;
- issued/expiry timestamps;
- one signing callback.

Lease objects with extra fields are rejected, which fails closed on attempted raw-key fields. There is no built-in secret-store client, environment lookup, browser key access, PEM parser, Node crypto implementation, WebCrypto private-key import, or filesystem key loading in this boundary.

## Signing contract

The boundary accepts only the canonical GitHub App JWT sign request and requires:

- `RS256`;
- the exact bound issuer;
- safe integer `iat` / `exp` seconds;
- positive JWT lifetime no greater than ten minutes;
- current time inside the activation window;
- JWT `exp` not later than the activation expiry.

Core deterministically builds the exact JWT header/payload signing input. The isolated lease capability is called exactly once for that input, and the returned signature must be bounded unpadded base64url text.

## Callback lifecycle

The signer is single-use per activation binding.

The private-key lease provider callback:

- may be entered once;
- is revoked as soon as the provider invocation settles;
- may not be captured and used later;
- must return the exact callback result;
- may not re-enter or substitute a result.

Raw lease/signature errors are sanitized. The resulting JWT is delivered only to the injected installation-token mint callback and is not stored or returned as a public signer artifact.

## Explicit non-authority

This slice does not provide:

- a real private key;
- AWS Secrets Manager/KMS, Vault, GitHub secret, environment, filesystem, or other secret-store access;
- a built-in RSA signing implementation;
- production secret configuration;
- live GitHub installation-token mint activation;
- a durable activation store or kill-switch implementation;
- token revocation;
- a live branch/commit/PR canary;
- merge or auto-merge;
- workflow dispatch;
- force push or protected-base writes;
- billing/provider/production-application mutation;
- Solve Runner authority.

A future isolated runtime adapter may implement the lease/signing capability against an approved secret source/HSM/KMS, but that implementation must preserve the exact binding/fingerprint/lease/callback contract and remain separately owner-activated. The final live PR canary remains a distinct authorization gate.
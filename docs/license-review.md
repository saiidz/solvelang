# License Review

SolveLang currently includes an MIT license at the repository root.

## Current decision

Keep the existing MIT license unchanged for this open-source-readiness phase.

## Why

MIT is simple, permissive, and familiar to developers evaluating or contributing to an early open-source project. Changing licenses while the product and business model are still evolving would add legal and community complexity without a demonstrated need.

## What this review does not claim

This document is not legal advice and does not determine:

- ownership of third-party contributions
- trademark rights in the SolveLang name/logo
- compatibility of every dependency license
- future commercial licensing strategy
- whether a contributor license agreement is needed later

## Before a future license change

A future licensing decision should inventory:

1. repository copyright ownership;
2. accepted external contributions;
3. dependency and bundled-asset licenses;
4. desired commercial/open-source model;
5. trademark policy;
6. whether hosted services or enterprise modules create a reason for different licensing.

Do not retroactively imply that existing contributors agreed to new terms without the appropriate legal process.

## Dependency review

Package managers and source manifests should be used to produce a dependency-license inventory before any distribution or commercial compliance claim is made. This PR does not claim that such an inventory has been completed.

# Production cross-feature state preservation

Status: **build-only hardening; no deployment in this branch**.

Production Admin CRM is now an independently enabled feature on the shared API stack. Authentication deployments and emergency rollback must not turn it off as an incidental side effect.

## Contract

- `AdminCrmEnabled` remains independent from customer authenticator 2FA and subscription billing.
- The dedicated CRM rollout is the only reviewed workflow whose purpose is to change the CRM flag.
- Ordinary customer-account and TOTP deployments must never force `AdminCrmEnabled=false`.
- CloudFormation stack updates reuse the existing value for parameters that are not overridden, so the current authentication workflows preserve the CRM flag by omission.
- The shared rollback script additionally carries `AdminCrmEnabled` explicitly. New callers should provide the exact captured starting flag through `INITIAL_ADMIN_CRM_ENABLED`.
- For backward compatibility with already-reviewed callers, if that variable is absent the rollback script reads the current stack parameter instead of defaulting to false.
- If the current stack does not expose a valid `AdminCrmEnabled` parameter, rollback fails closed rather than inferring a state.
- After rollback, the script re-reads CloudFormation and verifies that the CRM flag equals the value it restored; a missing post-rollback parameter also fails closed.
- Billing remains forced false in the shared rollback.

## Future workflow changes

Any workflow that begins explicitly overriding `AdminCrmEnabled` must first capture the exact initial flag and prove state restoration in its post-deploy/rollback tests. Authentication rollout code must never assume the CRM default represents the live production state.

import assert from "node:assert/strict";
import test from "node:test";
import { createAccessGuardedCustomerAuthService } from "../src/customer-auth-access-service.js";
import { ApiAccessError } from "../src/service.js";

test("restricted magic-link request keeps the generic accepted response", async () => {
  let calls = 0;
  const guarded = createAccessGuardedCustomerAuthService({
    async requestMagicLink() {
      calls += 1;
      throw new ApiAccessError(403, "account_access_restricted", "Account access is unavailable.");
    },
  });
  assert.deepEqual(await guarded.requestMagicLink({ email: "restricted@example.com" }), { accepted: true });
  assert.equal(calls, 1);
});

test("non-access magic-link failures are not hidden", async () => {
  const guarded = createAccessGuardedCustomerAuthService({
    async requestMagicLink() {
      throw new Error("mail provider unavailable");
    },
  });
  await assert.rejects(() => guarded.requestMagicLink({ email: "person@example.com" }), /mail provider unavailable/);
});

test("non-magic-link methods delegate unchanged", async () => {
  const service = {
    async requestMagicLink() { return { accepted: true }; },
    async authenticate(cookie) { return { cookie }; },
  };
  const guarded = createAccessGuardedCustomerAuthService(service);
  assert.deepEqual(await guarded.authenticate("session=test"), { cookie: "session=test" });
});

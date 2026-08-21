import assert from "node:assert/strict";
import test from "node:test";
import {
  createCustomerPriorityProviderCredentialLoader,
  parseCustomerPriorityProviderSecretArn,
} from "../src/customer-priority-provider-credentials.js";

const ACCOUNT_ID = "817198673108";
const REGION = "us-east-2";
const SECRET_ARN = `arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:solvelang/priority/production/provider-key-AbCd12`;

test("provider credential reference requires one complete production Secrets Manager ARN", () => {
  assert.equal(
    parseCustomerPriorityProviderSecretArn(SECRET_ARN, { region: REGION, accountId: ACCOUNT_ID }),
    SECRET_ARN,
  );

  assert.throws(
    () => parseCustomerPriorityProviderSecretArn(
      `arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:solvelang/priority/production/provider-key`,
      { region: REGION, accountId: ACCOUNT_ID },
    ),
    /complete Secrets Manager ARN/,
  );
  assert.throws(
    () => parseCustomerPriorityProviderSecretArn(
      `arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:other/service/provider-key-AbCd12`,
      { region: REGION, accountId: ACCOUNT_ID },
    ),
    /production priority namespace/,
  );
  assert.throws(
    () => parseCustomerPriorityProviderSecretArn(SECRET_ARN, { region: "us-east-1", accountId: ACCOUNT_ID }),
    /worker region/,
  );
  assert.throws(
    () => parseCustomerPriorityProviderSecretArn(SECRET_ARN, { region: REGION, accountId: "123456789012" }),
    /worker account/,
  );
});

test("credential loader gives the secret reader only the immutable ARN reference", async () => {
  const calls = [];
  const loader = createCustomerPriorityProviderCredentialLoader({
    secretArn: SECRET_ARN,
    region: REGION,
    accountId: ACCOUNT_ID,
    readSecret: async (input) => {
      calls.push(input);
      return { secretArn: SECRET_ARN, secretValue: "provider-credential-value" };
    },
  });

  assert.equal(await loader(), "provider-credential-value");
  assert.deepEqual(calls, [{ secretArn: SECRET_ARN }]);
});

test("credential loader fails closed on a mismatched, empty, or oversized secret response", async () => {
  const cases = [
    { secretArn: `${SECRET_ARN}x`, secretValue: "provider-credential-value" },
    { secretArn: SECRET_ARN, secretValue: "" },
    { secretArn: SECRET_ARN, secretValue: "x".repeat((64 * 1024) + 1) },
  ];

  for (const response of cases) {
    const loader = createCustomerPriorityProviderCredentialLoader({
      secretArn: SECRET_ARN,
      region: REGION,
      accountId: ACCOUNT_ID,
      readSecret: async () => response,
    });
    await assert.rejects(loader(), /secret response is invalid/);
  }
});

test("credential loader requires an explicit secret reader and does not embed credential data in errors", async () => {
  assert.throws(
    () => createCustomerPriorityProviderCredentialLoader({
      secretArn: SECRET_ARN,
      region: REGION,
      accountId: ACCOUNT_ID,
    }),
    /secret reader is required/,
  );

  const sensitive = "do-not-log-this-provider-secret";
  const loader = createCustomerPriorityProviderCredentialLoader({
    secretArn: SECRET_ARN,
    region: REGION,
    accountId: ACCOUNT_ID,
    readSecret: async () => ({ secretArn: SECRET_ARN, secretValue: sensitive.repeat(3000) }),
  });

  await assert.rejects(loader(), (error) => {
    assert.equal(error.message.includes(sensitive), false);
    return /secret response is invalid/.test(error.message);
  });
});

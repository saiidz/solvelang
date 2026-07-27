import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile("template.yaml", "utf8");

function functionBlock(name: string): string {
  const match = template.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z0-9]+:\\n|^Outputs:)`, "m"));
  assert.ok(match, `${name} must exist in the SAM template`);
  return match[1];
}

test("SAM config supplies every module-initialized confirmation worker environment contract", () => {
  const worker = functionBlock("ConfirmationWorkerFunction");
  assert.match(worker, /DURABLE_CONFIRMATION_SENDER: !Ref DurableConfirmationSender/);
  assert.match(worker, /DURABLE_CONFIRMATION_DELIVERY_TABLE: !Ref ConfirmationDeliveryTable/);
  const entitlement = functionBlock("EntitlementFunction");
  assert.doesNotMatch(entitlement, /DURABLE_CONFIRMATION_DELIVERY_TABLE/);
});

test("confirmation outbox and delivery ledgers use encrypted TTL-backed tables and a stream dispatcher", () => {
  assert.match(functionBlock("ConfirmationDispatchTable"), /StreamViewType: NEW_IMAGE/);
  assert.match(functionBlock("ConfirmationDispatchTable"), /AttributeName: expiresAt/);
  assert.match(functionBlock("ConfirmationDeliveryTable"), /AttributeName: expiresAt/);
  const dispatcher = functionBlock("ConfirmationDispatcherFunction");
  assert.match(dispatcher, /CONFIRMATION_DISPATCH_TABLE: !Ref ConfirmationDispatchTable/);
  assert.match(dispatcher, /DURABLE_CONFIRMATION_PROVIDER: !Ref DurableConfirmationProvider/);
  assert.match(dispatcher, /DURABLE_CONFIRMATION_QUEUE_URL: !Ref ConfirmationQueue/);
  assert.match(dispatcher, /Type: DynamoDB/);
});

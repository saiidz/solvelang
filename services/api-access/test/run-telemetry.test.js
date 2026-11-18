import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { runEventFromBody } from "../src/run-telemetry.js";
import { createDynamoRunTelemetryStore, runTelemetryDayKey, RUN_TELEMETRY_ALL_KEY } from "../src/run-telemetry-store.js";
import { ApiAccessError } from "../src/service.js";

const at = Date.parse("2026-11-18T12:00:00Z");

// Minimal in-memory DynamoDB document client: applies ADD updates and
// point reads against a Map, recording every command it receives.
function fakeDynamo() {
  const items = new Map();
  const calls = [];
  return {
    items,
    calls,
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      calls.push([name, input]);
      if (name === "UpdateCommand") {
        const key = input.Key.counterKey;
        const field = input.ExpressionAttributeNames["#counter"];
        const delta = input.ExpressionAttributeValues[":one"];
        const item = items.get(key) ?? { counterKey: key };
        item[field] = (item[field] ?? 0) + delta;
        items.set(key, item);
        return {};
      }
      if (name === "GetCommand") {
        const item = items.get(input.Key.counterKey);
        return item ? { Item: structuredClone(item) } : {};
      }
      throw new Error(`Unexpected DynamoDB command: ${name}`);
    },
  };
}

function event(method, rawPath, body) {
  return {
    rawPath,
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, sourceIp: "203.0.113.8" } },
  };
}

function handlerWith(runTelemetry) {
  return createApiAccessHandler({
    service: {},
    enabled: false,
    adminSecret: "a".repeat(64),
    siteOrigin: "https://www.solve-lang.com",
    runTelemetry,
    logger: { error() {} },
  });
}

test("run event payload accepts exactly a start or complete event", () => {
  assert.equal(runEventFromBody({ event: "start" }), "start");
  assert.equal(runEventFromBody({ event: "complete" }), "complete");
});

test("run event payload rejects anything beyond the single event field", () => {
  const invalid = [
    undefined,
    null,
    "start",
    [],
    {},
    { event: "bogus" },
    { event: "START" },
    { event: 1 },
    { event: "start", code: "print(1)" },
    { event: "complete", output: "hello" },
    { run: "start" },
  ];
  for (const body of invalid) {
    assert.throws(
      () => runEventFromBody(body),
      (error) => error instanceof ApiAccessError && error.statusCode === 400 && error.code === "invalid_run_event",
      `payload must be rejected: ${JSON.stringify(body)}`,
    );
  }
});

test("store increments the all-time and UTC-day counters and reads them back", async () => {
  const dynamo = fakeDynamo();
  const store = createDynamoRunTelemetryStore(dynamo, "run-telemetry", { now: () => at });
  assert.deepEqual(await store.readCounts(), { totalStart: 0, totalComplete: 0, todayStart: 0, todayComplete: 0 });

  await store.record("start");
  await store.record("start");
  await store.record("complete");

  assert.deepEqual(await store.readCounts(), { totalStart: 2, totalComplete: 1, todayStart: 2, todayComplete: 1 });
  assert.equal(runTelemetryDayKey(at), "run-counts#2026-11-18");
  assert.deepEqual(dynamo.items.get(RUN_TELEMETRY_ALL_KEY), { counterKey: RUN_TELEMETRY_ALL_KEY, start: 2, complete: 1 });
  assert.deepEqual(dynamo.items.get("run-counts#2026-11-18"), { counterKey: "run-counts#2026-11-18", start: 2, complete: 1 });
});

test("store writes nothing beyond the counter key and the two counts", async () => {
  const dynamo = fakeDynamo();
  const store = createDynamoRunTelemetryStore(dynamo, "run-telemetry", { now: () => at });
  await store.record("start");
  await store.record("complete");
  const updates = dynamo.calls.filter(([name]) => name === "UpdateCommand");
  assert.equal(updates.length, 4, "each event updates the all-time and day items");
  for (const [, input] of updates) {
    assert.deepEqual(Object.keys(input.Key), ["counterKey"]);
    assert.equal(input.UpdateExpression, "ADD #counter :one");
    assert.deepEqual(input.ExpressionAttributeValues, { ":one": 1 });
  }
  for (const item of dynamo.items.values()) {
    for (const key of Object.keys(item)) assert.ok(["counterKey", "start", "complete"].includes(key), `unexpected stored attribute: ${key}`);
  }
});

test("handler records valid beacons and serves aggregate counts with no auth", async () => {
  const recorded = [];
  const handler = handlerWith({
    record: async (value) => { recorded.push(value); },
    readCounts: async () => ({ totalStart: 5, totalComplete: 4, todayStart: 2, todayComplete: 1 }),
  });

  const started = await handler(event("POST", "/telemetry/run", { event: "start" }));
  assert.equal(started.statusCode, 204);
  const completed = await handler(event("POST", "/telemetry/run", { event: "complete" }));
  assert.equal(completed.statusCode, 204);
  assert.deepEqual(recorded, ["start", "complete"]);

  const counts = await handler(event("GET", "/telemetry/run-counts"));
  assert.equal(counts.statusCode, 200);
  assert.deepEqual(JSON.parse(counts.body), { totalStart: 5, totalComplete: 4, todayStart: 2, todayComplete: 1 });
});

test("handler rejects malformed beacons with 400 and records nothing", async () => {
  const recorded = [];
  const handler = handlerWith({
    record: async (value) => { recorded.push(value); },
    readCounts: async () => ({ totalStart: 0, totalComplete: 0, todayStart: 0, todayComplete: 0 }),
  });
  for (const body of [{ event: "bogus" }, { event: "start", code: "print(1)" }, {}, { event: 7 }]) {
    const response = await handler(event("POST", "/telemetry/run", body));
    assert.equal(response.statusCode, 400, `payload must be rejected: ${JSON.stringify(body)}`);
    assert.equal(JSON.parse(response.body).code, "invalid_run_event");
  }
  assert.deepEqual(recorded, []);
});

test("telemetry routes fail closed when the store is not wired", async () => {
  const handler = handlerWith(undefined);
  const post = await handler(event("POST", "/telemetry/run", { event: "start" }));
  assert.equal(post.statusCode, 503);
  assert.equal(JSON.parse(post.body).code, "run_telemetry_disabled");
  const get = await handler(event("GET", "/telemetry/run-counts"));
  assert.equal(get.statusCode, 503);
});

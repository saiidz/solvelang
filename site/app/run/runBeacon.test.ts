import assert from "node:assert/strict";
import test from "node:test";
import { createRunBeaconSender } from "./runBeacon";

type RecordedCall = {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string; keepalive: boolean };
};

test("beacon posts only the event name to the telemetry route", () => {
  const calls: RecordedCall[] = [];
  const send = createRunBeaconSender({
    apiBase: "https://api.solve-lang.com",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {};
    },
  });
  send("start");
  send("complete");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.solve-lang.com/telemetry/run");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.keepalive, true);
  assert.deepEqual(JSON.parse(calls[0].init.body), { event: "start" });
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)), ["event"]);
  assert.deepEqual(JSON.parse(calls[1].init.body), { event: "complete" });
});

test("beacon stays silent when the network throws or rejects", async () => {
  const throwing = createRunBeaconSender({
    apiBase: "https://api.solve-lang.com",
    fetchImpl: () => {
      throw new Error("offline");
    },
  });
  assert.doesNotThrow(() => throwing("start"));
  const rejecting = createRunBeaconSender({
    apiBase: "https://api.solve-lang.com",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.doesNotThrow(() => rejecting("complete"));
  // Let the rejected promise settle; the sender attaches a catch, so
  // nothing may surface as an unhandled rejection.
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("beacon does nothing without an API base", () => {
  let calls = 0;
  const send = createRunBeaconSender({
    apiBase: "",
    fetchImpl: async () => {
      calls++;
      return {};
    },
  });
  send("start");
  assert.equal(calls, 0);
});

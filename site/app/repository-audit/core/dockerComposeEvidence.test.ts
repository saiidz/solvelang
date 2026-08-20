import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDockerCompose } from "./dockerComposeEvidence";

test("collects bounded Compose service names and literal image declarations without execution", () => {
  const result = analyzeDockerCompose(`
services:
  web:
    image: ghcr.io/example/web:1.2.3
  worker:
    image: "ghcr.io/example/worker:1.2.3"
  dynamic:
    image: ${"${REGISTRY}/dynamic:latest"}
`);

  assert.deepEqual(result.services, [
    { name: "dynamic", imageState: "unresolved" },
    { name: "web", image: "ghcr.io/example/web:1.2.3", imageState: "declared" },
    { name: "worker", image: "ghcr.io/example/worker:1.2.3", imageState: "declared" },
  ]);
  assert.deepEqual(result.execution, {
    containerBuild: false,
    imageResolution: false,
    networkAccess: false,
    writeAccess: false,
  });
});

test("uses stable service ordering and rejects oversized Compose text", () => {
  const result = analyzeDockerCompose(`
services:
  z:
    image: z:1
  a:
    image: a:1
`);

  assert.deepEqual(result.services.map((service) => service.name), ["a", "z"]);
  assert.throws(() => analyzeDockerCompose("x".repeat(1024 * 1024 + 1)), /1 MiB text bound/);
});

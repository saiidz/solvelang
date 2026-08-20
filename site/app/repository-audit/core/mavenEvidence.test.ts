import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMavenPom } from "./mavenEvidence";

test("collects bounded Maven dependency and reactor-module evidence without resolution", () => {
  const result = analyzeMavenPom(`
<project>
  <modules><module>../shared</module><module>web</module></modules>
  <dependencyManagement>
    <dependencies><dependency><groupId>managed</groupId><artifactId>only</artifactId><version>1.0.0</version></dependency></dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency><groupId>org.example</groupId><artifactId>api</artifactId><version>1.2.0</version><scope>test</scope></dependency>
    <dependency><groupId>org.example</groupId><artifactId>inherited</artifactId><version>${"${revision}"}</version></dependency>
  </dependencies>
</project>
`);

  assert.deepEqual(result.dependencies, [
    { groupId: "org.example", artifactId: "api", version: "1.2.0", scope: "test", state: "declared" },
    { groupId: "org.example", artifactId: "inherited", state: "unresolved" },
  ]);
  assert.deepEqual(result.reactorModules, [
    { path: "../shared", state: "outside-scan" },
    { path: "web", state: "outside-scan" },
  ]);
  assert.deepEqual(result.execution, {
    buildEvaluation: false,
    networkAccess: false,
    repositoryResolution: false,
    writeAccess: false,
  });
});

test("uses stable order and rejects oversized POM text", () => {
  const result = analyzeMavenPom(`
<dependencies>
  <dependency><groupId>z</groupId><artifactId>z</artifactId><version>1</version></dependency>
  <dependency><groupId>a</groupId><artifactId>a</artifactId><version>1</version></dependency>
</dependencies>
<modules><module>z</module><module>a</module></modules>
`);

  assert.deepEqual(result.dependencies.map((item) => item.groupId), ["a", "z"]);
  assert.deepEqual(result.reactorModules.map((item) => item.path), ["a", "z"]);
  assert.throws(() => analyzeMavenPom("x".repeat(1024 * 1024 + 1)), /1 MiB text bound/);
});

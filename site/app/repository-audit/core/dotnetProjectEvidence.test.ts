import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDotnetProject } from "./dotnetProjectEvidence";

test("collects bounded .NET package and project references without MSBuild evaluation", () => {
  const result = analyzeDotnetProject(`
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Serilog" Version="3.1.0" />
    <PackageReference Include="NoVersion" />
    <ProjectReference Include="../Shared/Shared.csproj" />
  </ItemGroup>
</Project>
`);

  assert.deepEqual(result.packageReferences, [
    { name: "NoVersion", state: "unresolved" },
    { name: "Serilog", version: "3.1.0", state: "declared" },
  ]);
  assert.deepEqual(result.projectReferences, [
    { path: "../Shared/Shared.csproj", state: "outside-scan" },
  ]);
  assert.deepEqual(result.execution, {
    msbuildEvaluation: false,
    networkAccess: false,
    nugetResolution: false,
    writeAccess: false,
  });
});

test("uses stable ordering and rejects oversized project text", () => {
  const result = analyzeDotnetProject(`
<PackageReference Include="Z" Version="1.0.0" />
<PackageReference Include="A" Version="1.0.0" />
<ProjectReference Include="./z/z.csproj" />
<ProjectReference Include="./a/a.csproj" />
`);

  assert.deepEqual(result.packageReferences.map((item) => item.name), ["A", "Z"]);
  assert.deepEqual(result.projectReferences.map((item) => item.path), ["./a/a.csproj", "./z/z.csproj"]);
  assert.throws(() => analyzeDotnetProject("x".repeat(1024 * 1024 + 1)), /1 MiB text bound/);
});

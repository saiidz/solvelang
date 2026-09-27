import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isStudioAcceptanceBuild, isStudioProductionBuild, PRODUCTION_API_BASE_URL, studioBuildEnvironment } from "../scripts/build-studio-acceptance.mjs";

const base = {
  AWS_BRANCH: "studio-acceptance",
  STUDIO_ACCEPTANCE_PREVIEW_ENABLED: "true",
  NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED: "true",
  NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW: "true",
  NEXT_PUBLIC_API_ACCESS_BASE_URL: PRODUCTION_API_BASE_URL,
};

test("the repository-root Amplify build runs the guarded selector", () => {
  const spec = readFileSync(new URL("../../amplify.yml", import.meta.url), "utf8");
  assert.match(spec, /appRoot:\s*site/);
  assert.match(spec, /rm -f \.env\.production/);
  assert.match(spec, /npm run test:studio-acceptance-build/);
  assert.match(spec, /npm run build:studio-acceptance/);
});

test("account-saving UI is compiled only for the explicitly opted-in acceptance branch", () => {
  assert.equal(isStudioAcceptanceBuild(base), true);
  const accepted = studioBuildEnvironment(base);
  assert.equal(accepted.NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED, "true");
  assert.equal(accepted.NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW, "true");
  assert.equal(accepted.NEXT_PUBLIC_API_ACCESS_BASE_URL, base.NEXT_PUBLIC_API_ACCESS_BASE_URL);
});

test("production, other PRs, unapproved previews and malformed PR metadata fail closed", () => {
  const cases = [
    { ...base, AWS_BRANCH: "main" },
    { ...base, AWS_BRANCH: "studio-acceptance-copy" },
    { AWS_BRANCH: "studio-acceptance" },
    { ...base, STUDIO_ACCEPTANCE_PREVIEW_ENABLED: "false" },
  ];
  for (const environment of cases) {
    assert.equal(isStudioAcceptanceBuild(environment), false);
    const result = studioBuildEnvironment(environment);
    assert.equal(result.NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED, undefined);
    assert.equal(result.NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW, undefined);
  }
});

test("an app-wide public flag cannot enable account saving outside the acceptance preview", () => {
  const result = studioBuildEnvironment({ AWS_BRANCH: "main", NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED: "true" });
  assert.equal(result.NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED, undefined);
});

test("production account saving requires an explicit main selector and the verified API", () => {
  const production = { ...base, AWS_BRANCH: "main", STUDIO_PRODUCTION_ACCOUNT_SAVING_ENABLED: "true" };
  assert.equal(isStudioProductionBuild(production), true);
  const result = studioBuildEnvironment(production);
  assert.equal(result.NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED, "true");
  assert.equal(result.NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW, undefined);
  assert.equal(result.NEXT_PUBLIC_API_ACCESS_BASE_URL, PRODUCTION_API_BASE_URL);
  assert.throws(() => studioBuildEnvironment({ ...production, NEXT_PUBLIC_API_ACCESS_BASE_URL: "https://api.example.test" }), /verified production API/);
});

test("the production selector cannot enable another branch or acceptance preview", () => {
  for (const AWS_BRANCH of ["studio-acceptance-copy", "preview", undefined]) {
    const result = studioBuildEnvironment({ ...base, AWS_BRANCH, STUDIO_PRODUCTION_ACCOUNT_SAVING_ENABLED: "true" });
    assert.equal(result.NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED, undefined);
    assert.equal(result.NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW, undefined);
  }
  const acceptance = studioBuildEnvironment({ ...base, STUDIO_PRODUCTION_ACCOUNT_SAVING_ENABLED: "true" });
  assert.equal(acceptance.NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW, "true");
});

test("the acceptance branch cannot build against a non-production API origin", () => {
  assert.throws(() => studioBuildEnvironment({ ...base, NEXT_PUBLIC_API_ACCESS_BASE_URL: "https://api.example.test" }), /verified production API/);
});

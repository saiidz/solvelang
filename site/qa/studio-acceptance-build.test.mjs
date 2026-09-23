import assert from "node:assert/strict";
import test from "node:test";
import { isStudioAcceptanceBuild, PRODUCTION_API_BASE_URL, studioBuildEnvironment } from "../scripts/build-studio-acceptance.mjs";

const base = {
  AWS_BRANCH: "studio-acceptance",
  STUDIO_ACCEPTANCE_PREVIEW_ENABLED: "true",
  NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED: "true",
  NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW: "true",
  NEXT_PUBLIC_API_ACCESS_BASE_URL: PRODUCTION_API_BASE_URL,
};

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

test("the acceptance branch cannot build against a non-production API origin", () => {
  assert.throws(() => studioBuildEnvironment({ ...base, NEXT_PUBLIC_API_ACCESS_BASE_URL: "https://api.example.test" }), /verified production API/);
});

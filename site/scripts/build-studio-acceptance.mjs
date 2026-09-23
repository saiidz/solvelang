import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const STUDIO_ACCEPTANCE_BRANCH = "studio-acceptance";
export const PRODUCTION_API_BASE_URL = "https://3l3y008e94.execute-api.us-east-2.amazonaws.com";

export function isStudioAcceptanceBuild(environment) {
  return environment.AWS_BRANCH === STUDIO_ACCEPTANCE_BRANCH
    && environment.STUDIO_ACCEPTANCE_PREVIEW_ENABLED === "true";
}

export function studioBuildEnvironment(environment) {
  const buildEnvironment = { ...environment };
  // Never inherit an app-wide public flag into main or an unrelated preview.
  delete buildEnvironment.NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED;
  delete buildEnvironment.NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW;
  if (isStudioAcceptanceBuild(environment)) {
    if (environment.NEXT_PUBLIC_API_ACCESS_BASE_URL !== PRODUCTION_API_BASE_URL) {
      throw new Error("Studio acceptance build must target the verified production API base URL.");
    }
    buildEnvironment.NEXT_PUBLIC_STUDIO_ACCOUNT_SAVING_ENABLED = "true";
    buildEnvironment.NEXT_PUBLIC_STUDIO_ACCEPTANCE_PREVIEW = "true";
  }
  return buildEnvironment;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: studioBuildEnvironment(process.env),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

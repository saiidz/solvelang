import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(process.argv[2] || resolve(sourceDirectory, ".release"));
const releaseFiles = Object.freeze(["index.html", "styles.css", "config.js", "app.js"]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const manifest = {
  schema: "solvelang.admin-console-static.v1",
  files: {},
};
const bundleEntries = [];

for (const filename of releaseFiles) {
  const source = await readFile(resolve(sourceDirectory, filename));
  const digest = sha256(source);
  manifest.files[filename] = { sha256: digest, bytes: source.byteLength };
  bundleEntries.push(`${filename}\0${digest}\0${source.byteLength}`);
  await writeFile(resolve(outputDirectory, filename), source);
}

manifest.bundleSha256 = sha256(Buffer.from(bundleEntries.join("\n"), "utf8"));
await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Built SolveLang admin console static release ${manifest.bundleSha256} at ${outputDirectory}`);

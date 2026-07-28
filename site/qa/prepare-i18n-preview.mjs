import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoute = path.join(siteRoot, "app", "[locale]");
const previewSource = path.join(siteRoot, "i18n-preview-source", "[locale]");

await rm(generatedRoute, { recursive: true, force: true });
if (process.env.I18N_DRAFT_PREVIEW === "true") {
  await cp(previewSource, generatedRoute, { recursive: true });
  console.log("Prepared explicit draft locale preview routes.");
} else {
  console.log("Production locale routes disabled; generated localized route count is zero.");
}

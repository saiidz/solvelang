import { createHmac } from "node:crypto";
import { buildInstallUrl } from "./github-app.js";

// Zero-step onboarding (S2): the signed-in customer's connect link for
// the branded product app (SolveLang Process Solution).
//
// The link's `state` is minted here, server-side only, from the
// caller's session account id - the browser never supplies the tenant
// or the expiry, so there is nothing for it to tamper with: state is
//
//   base64url(JSON { tenantId, exp }) + "." + hex HMAC-SHA256
//
// where the HMAC key is the product binding secret
// (PRODUCT_BINDING_SECRET) over the base64url part, and exp is ten
// minutes after minting (epoch milliseconds). The side that receives
// the customer back from GitHub's install screen re-computes the HMAC
// with the same secret and rejects any state whose signature does not
// match or whose exp has passed. Nothing here logs the secret or the
// state.

export const PRODUCT_CONNECT_STATE_TTL_MS = 10 * 60 * 1_000;

export function mintProductConnectState({ tenantId, bindingSecret, now = Date.now } = {}) {
  if (typeof tenantId !== "string" || !tenantId) throw new Error("Tenant account id is required.");
  if (typeof bindingSecret !== "string" || !bindingSecret) throw new Error("Product binding secret is required.");
  const timestamp = typeof now === "function" ? now() : now;
  const payloadPart = Buffer.from(
    JSON.stringify({ tenantId, exp: timestamp + PRODUCT_CONNECT_STATE_TTL_MS }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", bindingSecret).update(payloadPart).digest("hex");
  return `${payloadPart}.${signature}`;
}

export function createProductConnectLinkService({ bindingSecret, slug, now = Date.now } = {}) {
  if (typeof bindingSecret !== "string" || !bindingSecret) {
    throw new Error("Product connect link requires a binding secret.");
  }
  if (typeof slug !== "string" || !slug) {
    throw new Error("Product connect link requires the product app slug.");
  }
  return {
    createConnectLink(tenantId) {
      const state = mintProductConnectState({ tenantId, bindingSecret, now });
      return { installUrl: buildInstallUrl({ slug, state }) };
    },
  };
}

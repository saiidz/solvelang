// Acceptance uses only the dedicated Amplify branch origin. Keeping this
// shape narrow prevents the production API from becoming a general CORS proxy.
export const STUDIO_ACCEPTANCE_ORIGIN_PATTERN = /^https:\/\/studio-acceptance\.d[a-z0-9]+\.amplifyapp\.com$/;
export const STUDIO_ACCEPTANCE_ORIGIN_CLOUDFORMATION_PATTERN = '^$|^https://studio-acceptance\\.d[a-z0-9]+\\.amplifyapp\\.com$';

export function parseStudioAcceptanceOrigin(value, siteOrigin) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value === siteOrigin || !STUDIO_ACCEPTANCE_ORIGIN_PATTERN.test(value)) {
    throw new Error("STUDIO_ACCEPTANCE_ORIGIN must be the exact dedicated Amplify acceptance-branch HTTPS origin.");
  }
  return value;
}

export function isAllowedStudioOrigin(origin, siteOrigin, studioAcceptanceOrigin) {
  return origin === siteOrigin || (Boolean(studioAcceptanceOrigin) && origin === studioAcceptanceOrigin);
}

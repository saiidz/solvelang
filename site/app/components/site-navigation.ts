export const primaryLinks = [
  { label: "Audit", href: "/audit/" },
  { label: "Support demo", href: "/demo/support-triage/" },
  { label: "Browser preview", href: "/run/" },
  { label: "Studio", href: "/studio/" },
  { label: "Docs", href: "/resources/" },
  { label: "Status", href: "/status/" },
  { label: "Account", href: "/account/api-keys/" },
] as const;

export const toolLinks = [
  { label: "Workflow preflight", href: "/check/" },
  { label: "Repository audit", href: "/repository-audit/" },
  { label: "Server audit", href: "/server-audit/" },
  { label: "About SolveLang", href: "/about/" },
  { label: "API plans (preview)", href: "/api-pricing/" },
] as const;

export function normalizePath(pathname: string | null): string {
  const path = (pathname || "/").split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return path || "/";
}

export function isCurrentLink(pathname: string | null, href: string): boolean {
  const path = normalizePath(pathname);
  const target = normalizePath(href);
  if (target === "/account/api-keys") return path === "/account" || path.startsWith("/account/");
  return path === target || (target !== "/" && path.startsWith(`${target}/`));
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { normalizePath } from "./site-navigation";

// Shared account-area sidebar (account reorganization, STACK R2).
//
// A true sidebar, not a menu: a full-height LEFT column attached to
// the left edge of the signed-in account area — square corners, a
// right border only, the darker #0f1626 panel from the approved
// preview — showing every entry of both groups at all times. There
// is no toggle, no dropdown, and no collapsing at any width. At
// phone width the layout stacks and this same column renders as a
// wrapping horizontal strip above the content, every item still
// visible.
//
// Two groups, owner-approved (Nov 14, 2026), in order:
// - "Your account": Account home, API account, Live Center, Runner
//   minutes, Sign-in & security.
// - "Work": Studio, Workflow check, Repository audit, Server audit,
//   Audit, Run in browser, Process Solution.
// Every link is one plain single line — no sub-captions anywhere in
// the sidebar. Buying minutes lives on the Live Center / Runner
// minutes views and on the account home, not in this sidebar.
// Active state follows the current page across both groups: exactly
// the entry matching the current route is highlighted.
//
// Entry targets:
// - "Runner minutes" opens the Live Center. The board selects its
//   Minutes view from internal tab state only (LiveCenterBoard keeps
//   `tab` in useState; there is no query/hash addressing), so the
//   Minutes view is not deep-linkable and this entry links to the
//   Live Center itself.
// - "Sign-in & security" deep-links to the security group on the API
//   account (manage) page; a sibling stack adds that anchor id.
const SIGN_IN_SECURITY_HASH = "#sign-in-security";

type SidebarEntry = {
  id: string;
  label: string;
  href: string;
  isActive: (path: string, hash: string) => boolean;
};

const onPath = (target: string) => (path: string) =>
  path === target || path.startsWith(`${target}/`);

const ACCOUNT_ENTRIES: SidebarEntry[] = [
  {
    id: "account-home",
    label: "Account home",
    href: "/account/",
    isActive: (path) => path === "/account",
  },
  {
    id: "api-account",
    label: "API account",
    href: "/account/api-keys/",
    isActive: (path, hash) => onPath("/account/api-keys")(path) && hash !== SIGN_IN_SECURITY_HASH,
  },
  {
    id: "live-center",
    label: "Live Center",
    href: "/account/live-center/",
    isActive: (path) => onPath("/account/live-center")(path),
  },
  {
    id: "runner-minutes",
    label: "Runner minutes",
    href: "/account/live-center/",
    // Shares the Live Center target: the Minutes view is chosen inside
    // the board, not by URL, so it has no separate active state.
    isActive: () => false,
  },
  {
    id: "sign-in-security",
    label: "Sign-in & security",
    href: "/account/api-keys/#sign-in-security",
    isActive: (path, hash) => onPath("/account/api-keys")(path) && hash === SIGN_IN_SECURITY_HASH,
  },
];

const WORK_ENTRIES: SidebarEntry[] = [
  {
    id: "studio",
    label: "Studio",
    href: "/studio/",
    isActive: (path) => onPath("/studio")(path),
  },
  {
    id: "workflow-check",
    label: "Workflow check",
    href: "/check/",
    isActive: (path) => onPath("/check")(path),
  },
  {
    id: "repository-audit",
    label: "Repository audit",
    href: "/repository-audit/",
    isActive: (path) => onPath("/repository-audit")(path),
  },
  {
    id: "server-audit",
    label: "Server audit",
    href: "/server-audit/",
    isActive: (path) => onPath("/server-audit")(path),
  },
  {
    id: "audit",
    label: "Audit",
    href: "/audit/",
    isActive: (path) => onPath("/audit")(path),
  },
  {
    id: "run-in-browser",
    label: "Run in browser",
    href: "/run/",
    isActive: (path) => onPath("/run")(path),
  },
  {
    id: "process-solution",
    label: "Process Solution",
    href: "/process-solution/",
    isActive: (path) => onPath("/process-solution")(path),
  },
];

const GROUPS: { head: string; entries: SidebarEntry[] }[] = [
  { head: "Your account", entries: ACCOUNT_ENTRIES },
  { head: "Work", entries: WORK_ENTRIES },
];

export function AccountSidebar({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const path = normalizePath(pathname);
  const [hash, setHash] = useState("");

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  return (
    <aside
      data-account-sidebar="true"
      className={`w-full shrink-0 border-b border-[#26314d] bg-[#0f1626] sm:w-[184px] sm:border-b-0 sm:border-r min-[901px]:w-[232px] ${className}`}
    >
      <nav aria-label="Account" className="px-[10px] py-[18px]">
        {GROUPS.map((group, groupIndex) => (
          <div key={group.head}>
            <p
              className={`px-[14px] pb-[10px] pt-1 text-xs font-semibold uppercase tracking-[0.05em] text-[#8b949e] ${
                groupIndex > 0 ? "mt-4" : ""
              }`}
            >
              {group.head}
            </p>
            <ul className="flex flex-row flex-wrap gap-[2px] sm:flex-col sm:flex-nowrap">
              {group.entries.map((entry) => {
                const active = entry.isActive(path, hash);
                return (
                  <li key={entry.id}>
                    <Link
                      href={entry.href}
                      aria-current={active ? "page" : undefined}
                      className={`block whitespace-nowrap rounded-lg px-[14px] py-3 text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 sm:whitespace-normal ${
                        active
                          ? "bg-[#1e293b] font-semibold text-[#e6edf3]"
                          : "text-[#c9d1d9] hover:bg-[#1e293b] hover:text-[#e6edf3]"
                      }`}
                    >
                      {entry.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

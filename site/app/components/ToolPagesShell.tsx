"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AccountSidebar } from "./AccountSidebar";
import { normalizePath } from "./site-navigation";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  customerSessionChangedEvent,
  normalizeApiBase,
} from "../account/core/customer-api";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

// The signed-in work pages outside the account area (account
// reorganization, STACK R2b): the tool pages and the Studio
// workspace. The account area itself is wrapped by the account
// layout (STACK R2a) and is not listed here.
const WORK_ROUTES = [
  "/studio",
  "/check",
  "/repository-audit",
  "/server-audit",
  "/audit",
  "/run",
  "/process-solution",
] as const;

type SessionState = "loading" | "signed-in" | "signed-out" | "unavailable";

// Shared signed-in shell for the work/tool pages, mounted by the
// (english) layout around every page and gated twice — by route
// (only the work pages above) and by session (only when signed in,
// detected exactly like SiteAccountMenu and the account layout:
// GET /customer/account against the customer API).
//
// - Signed in on a work page: children render beside the shared
//   AccountSidebar — the same full-height LEFT column as the
//   account area (edge-attached, no gap or padding around it,
//   stretch-aligned; a wrapping horizontal strip above the content
//   at phone width). The sidebar component follows the current
//   route for its active state, so a tool page highlights its Work
//   entry and never an account entry. /audit/ is wrapped but has no
//   sidebar entry, so nothing highlights there.
// - Everywhere else (signed out, still checking, unavailable, or
//   any other route): children render exactly as before — no
//   sidebar, no shell, no visual change.
export function ToolPagesShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const path = normalizePath(pathname);
  const isWorkPage = WORK_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
  const [sessionState, setSessionState] = useState<SessionState>("loading");

  const refresh = useCallback(async () => {
    if (!isWorkPage || !API_BASE) {
      setSessionState("signed-out");
      return;
    }
    try {
      await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
      setSessionState("signed-in");
    } catch (caught) {
      setSessionState(caught instanceof CustomerApiError && caught.status === 401 ? "signed-out" : "unavailable");
    }
  }, [isWorkPage]);

  useEffect(() => {
    // The initial request reconciles client state with the server-owned session cookie.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const refreshOnFocus = () => { void refresh(); };
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener(customerSessionChangedEvent, refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener(customerSessionChangedEvent, refreshOnFocus);
    };
  }, [refresh]);

  if (!isWorkPage || sessionState !== "signed-in") {
    return <>{children}</>;
  }

  return (
    <div data-tool-shell="signed-in" className="flex w-full flex-col sm:flex-row sm:items-stretch">
      <AccountSidebar className="order-1" />
      <div className="order-2 min-w-0 flex-1">{children}</div>
    </div>
  );
}

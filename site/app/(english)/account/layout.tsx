"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AccountSidebar } from "@/app/components/AccountSidebar";
import {
  CustomerApiError,
  type CustomerDashboard,
  customerApi,
  customerSessionChangedEvent,
  normalizeApiBase,
} from "@/app/account/core/customer-api";

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_ACCESS_BASE_URL);

type SessionState = "loading" | "signed-in" | "signed-out" | "unavailable";

// Account-area shell (account reorganization, STACK R2).
//
// There is no server session: like SiteAccountMenu and the account
// pages themselves, this layout detects the session client-side with
// GET /customer/account against the customer API.
//
// - Signed IN: a true sidebar — a full-height LEFT column attached to
//   the left edge of the account area (the approved preview shape):
//   the shell is a flex row with no gap and no outer padding around
//   the sidebar, stretch-aligned so the column runs the full height
//   of the area, and the content sits to its right. Every sidebar
//   entry is visible at all times at desktop and tablet/panel
//   widths; nothing collapses or toggles. Below the `sm` breakpoint
//   (true phone width) the shell stacks as a column and the same
//   sidebar becomes a wrapping horizontal strip ABOVE the content,
//   with every item still visible. It never stacks underneath.
// - Signed OUT (and while the check is running or unavailable):
//   children render exactly as before — plain, no sidebar, no shell,
//   no visual change. Checkout flows keep their own logic untouched;
//   this layout only wraps children.
export default function AccountLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [sessionState, setSessionState] = useState<SessionState>("loading");

  const refresh = useCallback(async () => {
    if (!API_BASE) {
      setSessionState("signed-out");
      return;
    }
    try {
      await customerApi<CustomerDashboard>(API_BASE, "/customer/account", { method: "GET" });
      setSessionState("signed-in");
    } catch (caught) {
      setSessionState(caught instanceof CustomerApiError && caught.status === 401 ? "signed-out" : "unavailable");
    }
  }, []);

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

  if (sessionState !== "signed-in") {
    return <>{children}</>;
  }

  return (
    <div data-account-shell="signed-in" className="bg-slate-950 text-white">
      <div className="flex w-full flex-col sm:flex-row sm:items-stretch">
        <AccountSidebar className="order-1" />
        <div className="order-2 min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { AccountRail } from "./AccountRail";
import styles from "./account-shell.module.css";

// The signed-in account shell frame: the icon rail beside the page.
// Settings-family pages add their sidebar inside the content region
// through SettingsPane (AccountSidebar.tsx); primary pages — the
// Live Center board above all — sit in the full remaining width, so
// the board keeps its own wide measure. Server component: the frame
// adds no client JavaScript of its own.

export function AccountShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <AccountRail />
      <div className={styles.main}>{children}</div>
    </div>
  );
}

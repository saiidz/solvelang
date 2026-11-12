import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./account-shell.module.css";

// The 232px settings sidebar of the signed-in account shell, shown
// on settings-family pages inside a SettingsPane. Every entry names
// a real account surface; entries for commissioned-but-unbuilt
// surfaces carry their honest tag, exactly as the approved preview
// showed them. Pure server markup: the active entry is a prop the
// owning segment layout passes, so aria-current needs no client
// state.

export type SettingsActiveKey =
  | "github"
  | "api-keys"
  | "api-subscription"
  | "priority"
  | "support-automation"
  | null;

function SideIcon({ d, rect }: { d: string; rect?: { x: number; y: number; w: number; h: number } }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {rect ? <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="2" /> : null}
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SideLink({
  href,
  label,
  current = false,
  badge = null,
  icon,
}: {
  href: string;
  label: string;
  current?: boolean;
  badge?: string | null;
  icon: ReactNode;
}) {
  return (
    <Link href={href} className={styles.sideNavLink} aria-current={current ? "page" : undefined}>
      {icon}
      {label}
      {badge ? <span className={`${styles.badge} ${styles.badgeAmber}`}>{badge}</span> : null}
    </Link>
  );
}

export function AccountSidebar({ active = null }: { active?: SettingsActiveKey }) {
  return (
    <aside className={styles.sidebar} aria-label="Settings">
      <Link
        href="/account/github/"
        className={styles.statusEntry}
        aria-current={active === "github" ? "page" : undefined}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M9 17H7a5 5 0 0 1 0-10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" strokeLinecap="round" />
        </svg>
        GitHub connection
        <span className={`${styles.badge} ${styles.badgeAmber}`}>Not installed</span>
      </Link>

      <div className={styles.groupLabel} id="account-ws-label">
        Workspace settings
      </div>
      <div className={styles.switcher} role="img" aria-label="Workspace: saiidz">
        <span className={styles.wavatar} aria-hidden="true">
          S
        </span>{" "}
        saiidz
      </div>
      <nav className={styles.sideNav} aria-labelledby="account-ws-label">
        <SideLink
          href="/account/github/"
          label="Apps & installs"
          icon={<SideIcon d="" rect={{ x: 4, y: 4, w: 16, h: 16 }} />}
        />
        <SideLink
          href="/account/live-center/"
          label="Configuration"
          badge="Building"
          icon={<SideIcon d="M5 6.5h14M5 12h14M5 17.5h9" />}
        />
        <SideLink
          href="/account/api-subscription/"
          label="Billing"
          current={active === "api-subscription"}
          icon={<SideIcon d="M3 10.5h18" rect={{ x: 3, y: 6, w: 18, h: 13 }} />}
        />
        <SideLink
          href="/account/github/"
          label="Repositories"
          icon={
            <SideIcon d="M4 8.5A2.5 2.5 0 0 1 6.5 6h3l2 2.5h6A2.5 2.5 0 0 1 20 11v6.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
          }
        />
        <SideLink
          href="/account/support-automation/"
          label="Automations"
          current={active === "support-automation"}
          icon={<SideIcon d="M13 2 4.5 13.5H11L9.8 22 19 9.5h-6.5z" />}
        />
        <SideLink
          href="/account/live-center/"
          label="Merge protections"
          icon={<SideIcon d="M12 3 5 5.8v5.4c0 4.3 2.9 7.4 7 9 4.1-1.6 7-4.7 7-9V5.8z m-3 8.8 2.2 2.2L15.5 9.7" />}
        />
        <SideLink
          href="/account/live-center/"
          label="CI optimization"
          icon={<SideIcon d="M4 14a8 8 0 1 1 2.3 6.3 M4 20v-6h6" />}
        />
        <SideLink
          href="/account/github/"
          label="Connected accounts"
          icon={<SideIcon d="M3.5 19.5c.8-3.2 2.8-4.8 5.5-4.8s4.7 1.6 5.5 4.8M16 5.6a3.2 3.2 0 0 1 0 5.8M17.8 14.9c1.5.7 2.4 2.2 2.8 4.6" />}
        />
      </nav>

      <div className={styles.groupLabel} id="account-your-label">
        Your settings
      </div>
      <nav className={styles.sideNav} aria-labelledby="account-your-label">
        <SideLink
          href="/account/api-keys/"
          label="Account"
          icon={<SideIcon d="M5.5 20c.8-3.6 3.3-5.4 6.5-5.4s5.7 1.8 6.5 5.4" />}
        />
        <SideLink href="/account/api-keys/" label="Preferences" icon={<SideIcon d="M12 3v3M12 18v3M3 12h3M18 12h3" />} />
        <SideLink
          href="/account/api-keys/"
          label="API keys"
          current={active === "api-keys"}
          icon={<SideIcon d="M8 10.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8 m3 1 8-8M17 5l2.5 2.5M14.5 7.5 17 10" />}
        />
        <SideLink
          href="/account/live-center/"
          label="Notifications"
          icon={<SideIcon d="M6 16v-5a6 6 0 0 1 12 0v5l1.2 3H4.8z M10 21a2.2 2.2 0 0 0 4 0" />}
        />
      </nav>

      <p className={styles.sideFoot}>
        <strong>Review Assist</strong> is in design — when it ships, its findings land in your Inbox and on the pull
        request.
      </p>
    </aside>
  );
}

// SettingsPane: the sidebar beside the page, in one grid. On narrow
// screens the grid collapses to one column and the sidebar stacks
// above the page (the approved preview's 390px behaviour). Segment
// layouts render their page inside this pane unchanged.
export function SettingsPane({
  active = null,
  children,
}: {
  active?: SettingsActiveKey;
  children: ReactNode;
}) {
  return (
    <div className={styles.pane}>
      <AccountSidebar active={active} />
      <div className={styles.paneContent}>{children}</div>
    </div>
  );
}

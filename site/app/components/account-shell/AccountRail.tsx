import Link from "next/link";
import styles from "./account-shell.module.css";

// The 48px icon rail of the signed-in account shell: the primary
// destinations of the account area, icons only, with the full name
// in a tooltip that also appears on keyboard focus. Pure server
// markup — no client state, no fetches. The Inbox badge renders
// only when a caller already holds the waiting-on-you count; the
// shell itself never loads data, so by default there is no badge.

function RailIcon({ d, circle }: { d: string; circle?: { cx: number; cy: number; r: number } }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
      {circle ? <circle cx={circle.cx} cy={circle.cy} r={circle.r} /> : null}
    </svg>
  );
}

export function AccountRail({ inboxCount = null }: { inboxCount?: number | null }) {
  return (
    <nav className={styles.rail} aria-label="Primary">
      <Link href="/account/live-center/" className={styles.mark} aria-label="SolveLang account home — Live Center">
        S
      </Link>
      <Link href="/account/live-center/" className={styles.railLink} aria-label="Live Center — the board">
        <RailIcon d="M3 11.5 12 4l9 7.5 M5.5 10v9.5h13V10" />
        <span className={styles.tip}>Live Center</span>
      </Link>
      <Link href="/account/live-center/" className={styles.railLink} aria-label="Inbox — waiting on you">
        <RailIcon d="M4 5.5h16V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z M4 13h5l1.5 2.5h3L15 13h5" />
        {inboxCount !== null && inboxCount > 0 ? <span className={styles.count}>{inboxCount}</span> : null}
        <span className={styles.tip}>Inbox — waiting on you</span>
      </Link>
      <Link href="/account/live-center/" className={styles.railLink} aria-label="Runners">
        <RailIcon d="M13 2 4.5 13.5H11L9.8 22 19 9.5h-6.5z" />
        <span className={styles.tip}>Runners</span>
      </Link>
      <Link href="/account/live-center/" className={styles.railLink} aria-label="Insights — building">
        <RailIcon d="M4 20V4 M4 20h16 M8.5 16v-5 M12.5 16V8 M16.5 16v-8" />
        <span className={styles.tip}>
          Insights <em>· building</em>
        </span>
      </Link>
      <span className={styles.railLink} role="img" aria-label="Review Assist — in design">
        <RailIcon d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" circle={{ cx: 12, cy: 12, r: 3 }} />
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.tip}>
          Review Assist <em>· in design</em>
        </span>
      </span>
      <span className={styles.spacer} />
      <Link href="/account/support-automation/" className={styles.railLink} aria-label="Help and support">
        <RailIcon d="M9.5 9.3A2.6 2.6 0 0 1 12 7.8c1.4 0 2.5 1 2.5 2.2 0 1.7-2.4 2-2.4 3.5" circle={{ cx: 12, cy: 12, r: 9 }} />
        <span className={styles.tip}>Help</span>
      </Link>
      <Link href="/account/api-keys/" className={styles.railLink} aria-label="Settings">
        <RailIcon d="M12 2.8v3 M12 18.2v3 M2.8 12h3 M18.2 12h3 M5.5 5.5l2.1 2.1 M16.4 16.4l2.1 2.1 M18.5 5.5l-2.1 2.1 M7.6 16.4l-2.1 2.1" circle={{ cx: 12, cy: 12, r: 3.2 }} />
        <span className={styles.tip}>Settings</span>
      </Link>
      <Link href="/account/api-keys/" className={styles.railLink} aria-label="Your account">
        <RailIcon d="M5.5 20c.8-3.6 3.3-5.4 6.5-5.4s5.7 1.8 6.5 5.4" circle={{ cx: 12, cy: 8.5, r: 3.4 }} />
        <span className={styles.tip}>Your account</span>
      </Link>
    </nav>
  );
}

import styles from "../../../components/account-shell/account-shell.module.css";

// The Live Center is the account shell's wide variant: no settings
// sidebar — the board takes the full remaining width beside the
// rail and keeps its own wide measure. The page carries its own
// metadata, so this layout only marks the variant.
export default function LiveCenterLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={styles.wide}>{children}</div>;
}

import { AccountShell } from "../../components/account-shell/AccountShell";

// Every signed-in account page renders inside the account shell:
// the icon rail beside the page (see components/account-shell).
// Settings-family segments add their sidebar through their own
// layouts; the pages themselves are unchanged.
export default function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AccountShell>{children}</AccountShell>;
}

import { localeForSegment } from "../i18n/locales";

export default async function LocaleLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const locale = localeForSegment((await params).locale);
  if (!locale) return children;
  return <div lang={locale.code} dir={locale.direction}>{children}</div>;
}

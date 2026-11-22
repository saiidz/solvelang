import "../globals.css";

// Root layout for the statutory Romanian legal pages (/ro/*).
//
// These pages live outside the (english) route group, whose layout is the
// root layout for the English site, so this segment needs its own root
// layout. It is intentionally minimal: the pages render their own shell
// (see LegalShell in ../i18n/romanianLegal) and must not gain the English
// site's header, footer, or theme machinery. The globals import carries
// the design tokens (bg-canvas, text-ink, text-body, text-accent) the
// legal shell is styled with.
export default function RomanianRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ro" dir="ltr">
      <body>{children}</body>
    </html>
  );
}

import Image from "next/image";
import Link from "next/link";

const primaryLinks = [
  ["Audit", "/audit/"],
  ["Support demo", "/demo/support-triage/"],
  ["Browser preview", "/run/"],
  ["Studio", "/studio/"],
  ["Docs", "/resources/"],
  ["Status", "/status/"],
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-[100] border-b border-slate-200/90 bg-white/95 backdrop-blur-xl">
      <nav className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8" aria-label="Primary navigation">
        <Link href="/" aria-label="SolveLang home" className="shrink-0">
          <Image src="/solvelang-logo.svg" alt="SolveLang" width={194} height={41} className="h-auto w-[154px] sm:w-[176px]" priority />
        </Link>

        <div className="hidden items-center gap-5 text-sm font-semibold text-slate-600 lg:flex">
          {primaryLinks.map(([label, href]) => (
            <Link key={href} href={href} className="transition hover:text-slate-950">
              {label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link href="/account/" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:inline-flex">
            Account
          </Link>
          <Link href="/audit/" className="rounded-xl bg-[#146cff] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075be4]">
            Map workflow
          </Link>
          <details className="relative lg:hidden">
            <summary className="cursor-pointer list-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
              {primaryLinks.map(([label, href]) => (
                <Link key={href} href={href} className="block rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-950">
                  {label}
                </Link>
              ))}
              <Link href="/account/" className="block rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-950 sm:hidden">
                Account
              </Link>
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}

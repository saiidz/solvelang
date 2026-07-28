import Link from "next/link";

// This boundary is copied into App Router only for explicit draft previews.
export default function LocalizedNotFound() {
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-slate-950"><h1 className="text-4xl font-semibold">Page not found</h1><p className="mt-4 text-slate-600">This draft locale does not include the requested page.</p><Link className="mt-6 font-semibold text-blue-700 underline" href="/">Return to English</Link></main>;
}

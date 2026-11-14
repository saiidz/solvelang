import type { Metadata } from "next";
import { ThemeAppearance } from "../../../components/ThemeAppearance";

export const metadata: Metadata = {
  title: "Account Settings",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
  },
};

export default function AccountSettingsPage() {
  return (
    <main className="min-h-screen bg-canvas px-6 py-16 text-ink">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-3 leading-7 text-body">
          Settings for how SolveLang works for you on this device. More settings will appear here as
          they are added; today it holds your appearance choice.
        </p>
        <section
          aria-labelledby="appearance-heading"
          className="mt-10 rounded-3xl border border-line bg-panel p-6 sm:p-8"
        >
          <h2 id="appearance-heading" className="text-xl font-semibold">
            Appearance
          </h2>
          <p className="mt-2 leading-7 text-body">
            Choose how every SolveLang page looks: the original dark design, a light design with
            the same pages, the same words, and the same layout in brighter colours, or simply
            follow whatever your device is set to. Nothing about your account, your plans, or your
            work changes — only the colours.
          </p>
          <ThemeAppearance />
        </section>
      </div>
    </main>
  );
}

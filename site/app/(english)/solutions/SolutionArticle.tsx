import Link from "next/link";
import type { ReactNode } from "react";
import type { SolutionEntry } from "./solutions-data";

const codeClass = "rounded bg-panel-alt/70 px-1.5 py-0.5 font-mono text-[0.9em] text-ink";
const preClass = "overflow-x-auto rounded-xl bg-canvas p-4 font-mono text-sm leading-6 text-ink";

// Renders `backtick` spans in a plain string as inline code; everything
// else stays plain text, so data files never need markup.
function rich(text: string): ReactNode {
  const parts = text.split("`");
  if (parts.length === 1) return text;
  return parts.map((part, index) => (index % 2 === 1 ? <code key={index} className={codeClass}>{part}</code> : part));
}

function Paragraphs({ lines }: { lines: readonly string[] }) {
  return lines.map((line, index) => (
    <p key={index} className={index === 0 ? "mt-3 leading-7 text-muted" : "mt-3 leading-7 text-muted"}>
      {rich(line)}
    </p>
  ));
}

export function SolutionArticle({ entry }: { entry: SolutionEntry }) {
  return (
    <main className="min-h-screen bg-panel text-ink">
      <section className="mx-auto max-w-4xl px-6 py-20">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Solutions</p>
        <h1 className="mt-4 text-4xl font-semibold">{entry.title}</h1>
        <p className="mt-5 text-lg leading-8 text-muted">{entry.summary}</p>
        <div className="mt-10 space-y-5">
          <section className="rounded-2xl border border-line p-6">
            <h2 className="text-xl font-semibold">Symptom</h2>
            <Paragraphs lines={entry.symptom} />
          </section>
          <section className="rounded-2xl border border-line p-6">
            <h2 className="text-xl font-semibold">Cause</h2>
            <Paragraphs lines={entry.cause} />
          </section>
          <section className="rounded-2xl border border-line p-6">
            <h2 className="text-xl font-semibold">Fix</h2>
            {entry.fixIntro ? <p className="mt-3 leading-7 text-muted">{rich(entry.fixIntro)}</p> : null}
            <ol className="mt-3 list-decimal space-y-2 pl-5 leading-7 text-muted">
              {entry.fix.map((step, index) => (
                <li key={index}>{rich(step)}</li>
              ))}
            </ol>
          </section>
          <section className="rounded-2xl border border-line p-6">
            <h2 className="text-xl font-semibold">Example</h2>
            {entry.exampleText ? <p className="mt-3 leading-7 text-muted">{rich(entry.exampleText)}</p> : null}
            {entry.exampleCode ? (
              <pre className={`mt-4 ${preClass}`}>
                <code>{entry.exampleCode.join("\n")}</code>
              </pre>
            ) : null}
            {entry.exampleOutro ? <p className="mt-3 leading-7 text-muted">{rich(entry.exampleOutro)}</p> : null}
          </section>
        </div>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link href="/solutions/" className="rounded-xl bg-canvas px-5 py-3 text-sm font-semibold text-ink">
            All solutions
          </Link>
          <Link href="/support/" className="rounded-xl border border-line-strong px-5 py-3 text-sm font-semibold">
            Support
          </Link>
          <a href="mailto:hello@solve-lang.com" className="rounded-xl border border-line-strong px-5 py-3 text-sm font-semibold">
            hello@solve-lang.com
          </a>
        </div>
      </section>
    </main>
  );
}

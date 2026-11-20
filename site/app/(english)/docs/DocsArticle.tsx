import Link from "next/link";
import type { ReactNode } from "react";
import type { GuideEntry } from "./docs-data";

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
    <p key={index} className="mt-3 leading-7 text-muted">
      {rich(line)}
    </p>
  ));
}

export function DocsArticle({ entry }: { entry: GuideEntry }) {
  return (
    <main className="min-h-screen bg-panel text-ink">
      <section className="mx-auto max-w-4xl px-6 py-20">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Documentation</p>
        <h1 className="mt-4 text-4xl font-semibold">{entry.title}</h1>
        <p className="mt-5 text-lg leading-8 text-muted">{entry.summary}</p>
        <div className="mt-6">
          <Paragraphs lines={entry.intro} />
        </div>
        <div className="mt-10 space-y-5">
          {entry.sections.map((section) => (
            <section key={section.heading} className="rounded-2xl border border-line p-6">
              <h2 className="text-xl font-semibold">{section.heading}</h2>
              <Paragraphs lines={section.body} />
              {section.steps ? (
                <ol className="mt-3 list-decimal space-y-2 pl-5 leading-7 text-muted">
                  {section.steps.map((step, index) => (
                    <li key={index}>{rich(step)}</li>
                  ))}
                </ol>
              ) : null}
              {section.code
                ? section.code.map((block, index) => (
                    <div key={index}>
                      {block.intro ? <p className="mt-3 leading-7 text-muted">{rich(block.intro)}</p> : null}
                      <pre className={`mt-4 ${preClass}`}>
                        <code>{block.code.join("\n")}</code>
                      </pre>
                      {block.outro ? <p className="mt-3 leading-7 text-muted">{rich(block.outro)}</p> : null}
                    </div>
                  ))
                : null}
            </section>
          ))}
          <section className="rounded-2xl border border-line p-6">
            <h2 className="text-xl font-semibold">Honest limits</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-muted">
              {entry.limits.map((limit, index) => (
                <li key={index}>{rich(limit)}</li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-line p-6">
            <h2 className="text-xl font-semibold">Keep going</h2>
            <ul className="mt-3 space-y-2 leading-7">
              {entry.links.map((link) => (
                <li key={link.href}>
                  {link.href.startsWith("/") ? (
                    <Link className="font-semibold text-accent underline" href={link.href}>
                      {link.label}
                    </Link>
                  ) : (
                    <a className="font-semibold text-accent underline" href={link.href}>
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link href="/docs/" className="rounded-xl bg-canvas px-5 py-3 text-sm font-semibold text-ink">
            All guides
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

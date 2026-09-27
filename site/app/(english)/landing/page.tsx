import Image from "next/image";
import Link from "next/link";
import { billingAvailability } from "../../product-capabilities";
import { InteractiveHero } from "./InteractiveHero";
import styles from "./landing.module.css";

const contextStages = [
  { number: "01", title: "Plan", body: "Identify the files, relationships, and history that matter for this change." },
  { number: "02", title: "Pack", body: "Keep selected evidence structured, compact, and traceable to source." },
  { number: "03", title: "Retrieve", body: "Bring in relevant material as the task evolves, with exact provenance." },
  { number: "04", title: "Handoff", body: "Pass a structured pack so the next agent inherits evidence." },
];

function SectionEyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return <p className={`${styles.sectionEyebrow} ${light ? styles.sectionEyebrowLight : ""}`}>{children}</p>;
}

export default function Page() {
  return (
    <div className="bg-[#f5f6f4] text-[#102036]">
      <main>
        <InteractiveHero />

        <section id="boundaries" className={`${styles.boundarySection} scroll-mt-24`} aria-labelledby="boundary-title">
          <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[1fr_0.85fr] lg:gap-24 lg:px-10 lg:py-32">
            <div>
              <SectionEyebrow light>01 / THE BOUNDARY</SectionEyebrow>
              <h2 id="boundary-title" className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.07] tracking-[-0.055em] text-white sm:text-6xl">Real capability. <span className="text-[#8ab7ff]">Explicit boundaries.</span></h2>
              <p className="mt-7 max-w-2xl text-xl leading-8 text-[#c2cfdf]">Solve shows you what it actually did — and what it did not do.</p>
              <p className="mt-6 max-w-2xl leading-8 text-[#9fb0c6]">The browser preview runs a pinned WebAssembly build of SolveLang&apos;s canonical safe core with host side effects denied. It runs supported language behavior and returns deterministic output within that boundary without pretending it has unrestricted access to your machine, infrastructure, or production systems.</p>
              <Link href="/run/" className={styles.lightInlineLink}>Inspect the browser-safe preview <span aria-hidden="true">↗</span></Link>
            </div>
            <div className={styles.boundaryLedger} aria-label="Capability distinctions">
              <div><span>01</span><p>Repository-tested <strong>≠</strong> deployed</p></div>
              <div><span>02</span><p>Deployed <strong>≠</strong> verified live</p></div>
              <div><span>03</span><p>A sandbox <strong>≠</strong> unrestricted production execution</p></div>
              <div className={styles.boundaryLedgerFoot}><span className={styles.ledgerPulse} /> Scope is part of the result.</div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="scroll-mt-24 bg-[#f5f6f4] py-24 sm:py-32" aria-labelledby="capabilities-title">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
            <SectionEyebrow>02 / THREE THINGS SOLVE DOES DIFFERENTLY</SectionEyebrow>
            <h2 id="capabilities-title" className="mt-5 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.055em] sm:text-6xl">Understand the work before the work moves.</h2>
            <div className={styles.capabilityList}>
              <article className={styles.capabilityRow}>
                <span className={styles.capabilityNumber}>01</span>
                <div><p className={styles.capabilityKicker}>Give agents the right context</p><h3>Less noise. More evidence.</h3><p>Solve Context prepares focused repository context for coding agents instead of treating an entire codebase as one giant prompt. Plan, pack, retrieve, and hand off the evidence that matters across supported agent workflows.</p><p className={styles.capabilityDetail}>Inspect selected files and relationships, changed-path context, relevant graph evidence, and structured handoffs.</p><Link href="#solve-context" className={styles.darkInlineLink}>Explore Solve Context <span aria-hidden="true">↗</span></Link></div>
                <div className={styles.capabilityVisual} aria-hidden="true"><span className={styles.visualTag}>REPOSITORY</span><span className={styles.visualLine} /><span className={styles.visualTagActive}>SELECTED EVIDENCE</span><span className={styles.visualLine} /><span className={styles.visualTag}>AGENT</span></div>
              </article>
              <article className={styles.capabilityRow}>
                <span className={styles.capabilityNumber}>02</span>
                <div><p className={styles.capabilityKicker}>Understand a system before changing it</p><h3>See what a change can affect before you make it.</h3><p>Repository Audit and Solve Graph expose relationships across code, dependencies, validations, architecture, and security-relevant surfaces. Ask what depends on a file, which validations a change could affect, or where a workflow crosses a security boundary. Trace the evidence instead of relying on a confident guess.</p><Link href="/repository-audit/" className={styles.darkInlineLink}>Explore a sample audit <span aria-hidden="true">↗</span></Link></div>
                <div className={styles.impactVisual} aria-hidden="true"><span>src/page.tsx</span><i /><span>src/config.ts</span><b>BOUNDED IMPACT PATH</b></div>
              </article>
              <article className={styles.capabilityRow}>
                <span className={styles.capabilityNumber}>03</span>
                <div><p className={styles.capabilityKicker}>Model workflows before automating them</p><h3>Test the decision path before production has to.</h3><p>Workflow Intelligence Studio gives you a structured place to model how work moves, where decisions happen, what can fail, and where a human needs to stay in control. Build the workflow. Inspect the risks. Run scenarios. Trace the outcome.</p><p className={styles.capabilityDetail}>Studio is local-first by default. Projects stay in the browser unless you explicitly connect account saving.</p><Link href="/studio/" className={styles.darkInlineLink}>Open Studio <span aria-hidden="true">↗</span></Link></div>
                <div className={styles.decisionVisual} aria-hidden="true"><span>TRIGGER</span><i /><span>DECISION</span><i /><span>HUMAN REVIEW</span></div>
              </article>
            </div>
          </div>
        </section>

        <section id="studio" className={`${styles.studioSection} scroll-mt-24 py-24 sm:py-32`} aria-labelledby="studio-title">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-20">
              <div><SectionEyebrow light>03 / THE FLAGSHIP</SectionEyebrow><h2 id="studio-title" className="mt-5 text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.06em] text-white sm:text-7xl">Workflow Intelligence Studio</h2></div>
              <div><p className="text-2xl font-medium tracking-[-0.03em] text-[#a7cbff] sm:text-3xl">See the operation before you automate it.</p><p className="mt-5 max-w-xl leading-8 text-[#b9c8dc]">Most automation tools begin with execution. Studio begins with understanding. Map the people, systems, policies, decisions, and failure paths that make up a real process. Then test scenarios against that model before turning the workflow into something production has to depend on.</p></div>
            </div>
            <div className={styles.studioProduct} aria-hidden="true">
              <div className={styles.studioToolbar}><span className={styles.studioBrand}>△ <strong>Solve<span>Lang</span></strong></span><span>Support triage workspace</span><span className={styles.studioLocal}>● &nbsp;Local-first</span></div>
              <div className={styles.studioAppBody}>
                <div className={styles.studioSidebar}><small>WORKFLOW INTELLIGENCE</small><strong>Studio v1</strong>{["01  Projects", "02  Workflow Canvas", "03  Rule Inspector", "04  Scenario Lab", "05  Run Trace", "06  Analytics", "07  Versions", "08  Export"].map((item, index) => <span key={item} className={index === 1 ? styles.studioNavActive : ""}>{item}</span>)}</div>
                <div className={styles.studioViewport}><div className={styles.studioViewportHead}><span>WORKFLOW CANVAS / SUPPORT TRIAGE</span><span>Modeled example · no external action</span></div><div className={styles.studioGraph}><div><small>TRIGGER</small><strong>Incoming request</strong><span>Support message</span></div><i /><div><small>DECISION</small><strong>Urgency route</strong><span>Explicit policy branch</span></div><i /><div className={styles.studioGraphReview}><small>HUMAN REVIEW</small><strong>Financial change</strong><span>Approval required</span></div></div><div className={styles.studioTrace}><span>SCENARIO PATH</span><strong>Request → rule → review gate</strong><small>Model output only · nothing was sent</small></div></div>
              </div>
            </div>
            <p className={styles.productCaption}>Product-derived view of Studio&apos;s actual Projects, Canvas, Inspector, Scenario, and Trace surfaces. Open Studio to use the real workspace.</p>
            <div className={styles.studioActions}>{[
              ["Model", "Build a visual workflow from canonical nodes and relationships. Capture actions, decisions, systems, owners, policies, SLAs, and human-review points."],
              ["Inspect", "Run deterministic analysis. Surface missing controls, risky paths, unresolved decisions, policy gaps, and failure paths."],
              ["Test", "Create scenarios and follow the modeled path. See branches, policy checks, pauses, and unresolved outcomes."],
              ["Preserve", "Projects save locally first. Optional account saving keeps a private copy across devices without replacing the browser-first workflow."],
            ].map(([title, body]) => <div key={title}><h3>{title}</h3><p>{body}</p></div>)}</div>
            <Link href="/studio/" className={styles.studioButton}>Open Studio <span aria-hidden="true">↗</span></Link>
          </div>
        </section>

        <section id="solve-context" className="scroll-mt-24 bg-[#eaf0f3] py-24 sm:py-32" aria-labelledby="context-title">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
            <SectionEyebrow>04 / SOLVE CONTEXT</SectionEyebrow>
            <div className="mt-5 grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20"><div><h2 id="context-title" className="text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.06em] sm:text-7xl">Stop feeding agents your whole repository.</h2><p className="mt-7 max-w-2xl text-xl leading-8 text-[#3f5367]">Most agent workflows solve context the same way: dump everything into the window and hope the model finds what matters. That&apos;s noise with a token limit. Solve Context treats context as something you plan, not something you pile on.</p></div><div className={styles.contextStatement}><span>REPOSITORY</span><i aria-hidden="true">→</i><span>SELECTED EVIDENCE</span><i aria-hidden="true">→</i><span>STRUCTURED CONTEXT PACK</span><i aria-hidden="true">→</i><span>AGENT HANDOFF</span></div></div>
            <div className={styles.contextStages}>{contextStages.map((stage) => <div key={stage.number}><span>{stage.number}</span><h3>{stage.title}</h3><p>{stage.body}</p></div>)}</div>
            <div className={styles.contextClose}><div><p className="text-2xl font-semibold tracking-[-0.04em] text-[#102036] sm:text-3xl">What you get isn&apos;t a bigger context window. It&apos;s a smaller, traceable one — one you can follow back to source.</p><p className="mt-5 text-[#526579]">Real provider token and performance comparisons will be published only when the independent #898 evaluation supports them.</p></div><Link href="https://github.com/saiidz/solvelang/blob/main/docs/product/solve-context-v0.md" target="_blank" rel="noreferrer" className={styles.darkInlineLink}>Explore Solve Context <span aria-hidden="true">↗</span></Link></div>
          </div>
        </section>

        <section id="evidence" className={`${styles.evidenceSection} scroll-mt-24 py-24 sm:py-32`} aria-labelledby="evidence-title">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
            <SectionEyebrow light>05 / WHAT WE VERIFY</SectionEyebrow>
            <div className="mt-5 grid gap-12 lg:grid-cols-[1fr_0.75fr] lg:items-end lg:gap-20"><div><h2 id="evidence-title" className="text-balance text-5xl font-semibold tracking-[-0.06em] text-white sm:text-7xl">Claims should have a state — not just a headline.</h2><p className="mt-6 max-w-2xl text-xl leading-8 text-[#b8c9d9]">Solve separates what is implemented from what is actually proven.</p></div><p className="max-w-lg leading-8 text-[#93a9bd]">Deterministic behavior, traceable source evidence, explicit execution boundaries, and safety before side effects shape the product. Repository checks, browser acceptance, deployment verification, and live canaries are recorded separately.</p></div>
            <div className={styles.evidenceLedger}>
              <article><span className={styles.evidenceStatus}><i /> REPOSITORY-TESTED</span><h3>Repeatable by design.</h3><p>Core analysis and validation paths have deterministic tests. Findings, relationships, context selections, and handoffs retain source provenance. Repository-tested does not mean deployed.</p></article>
              <article><span className={styles.evidenceStatus}><i /> DEPLOYED</span><h3>Available with gates.</h3><p>The public site, production customer-account infrastructure, and Studio account saving are deployed. {billingAvailability} Paid priority and general managed execution remain separate gates.</p></article>
              <article><span className={styles.evidenceStatus}><i /> VERIFIED LIVE</span><h3>Bounded checks, named plainly.</h3><p>Studio passed six authenticated acceptance checks and a bounded production save/reload, isolation, and local-first smoke. The temporary acceptance-origin cleanup remains a separate follow-up.</p></article>
            </div>
            <div className={styles.benchmarkBand}><div><span>NO PLACEHOLDER PERCENTAGES</span><h3>Benchmarks will come with receipts.</h3><p>Solve Context provider-token, latency, and quality comparisons will be published only when the independent #898 evaluation supports them.</p></div><Link href="https://github.com/saiidz/solvelang/blob/main/docs/project-completion-evidence-2026-09-20.md" target="_blank" rel="noreferrer" className={styles.lightInlineLink}>View technical evidence <span aria-hidden="true">↗</span></Link></div>
          </div>
        </section>

        <section className={styles.builtBand} aria-labelledby="built-title"><div className="mx-auto flex max-w-[1440px] flex-col gap-7 px-5 py-10 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10"><div><p className={styles.builtEyebrow}>BUILT WITH SOLVE</p><h2 id="built-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">Real usage, not a logo wall.</h2><p className="mt-2 text-[#bacbdf]">This space grows with real workflows, integrations, and projects built with Solve. Nothing here is fabricated.</p></div><a href="mailto:hello@solve-lang.com?subject=Built%20with%20Solve%20project" className={styles.builtLink}>Building something with Solve? Submit your project <span aria-hidden="true">↗</span></a></div></section>

        <section id="quickstart" className="scroll-mt-24 bg-[#f5f6f4] py-24 sm:py-32" aria-labelledby="quickstart-title"><div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10"><SectionEyebrow>06 / START WITH SOLVE</SectionEyebrow><h2 id="quickstart-title" className="mt-5 max-w-4xl text-balance text-5xl font-semibold tracking-[-0.06em] sm:text-7xl">Choose the surface that fits the job.</h2><div className={styles.quickstartGrid}>
          <article><span>01 / NO INSTALLATION</span><h3>Open Studio</h3><p>Model a workflow visually, inspect risks, run scenarios, and preserve the evidence. Projects save locally first.</p><Link href="/studio/" className={styles.darkInlineLink}>Open Studio <span aria-hidden="true">↗</span></Link></article>
          <article><span>02 / PUBLISHED MCP SERVER</span><h3>Connect Solve Context</h3><p>Use the published MCP server with supported agent workflows. Point it at the workspace to inspect using <code>SOLVELANG_WORKSPACE_ROOT</code>.</p><pre><code>npx --yes @solvelang/mcp-server</code></pre><Link href="https://github.com/saiidz/solvelang/blob/main/docs/integrations/mcp-codex-claude.md" target="_blank" rel="noreferrer" className={styles.darkInlineLink}>View MCP setup <span aria-hidden="true">↗</span></Link></article>
          <article><span>03 / CANONICAL RUST CLI</span><h3>Run SolveLang locally</h3><p>Validate and run a repository example with the canonical native runtime.</p><pre><code>{`git clone https://github.com/saiidz/solvelang.git\ncd solvelang/solvec\ncargo run -- validate ../examples/support_triage.solve\ncargo run -- run ../examples/support_triage.solve`}</code></pre><details className={styles.nativeDetails}><summary>Native release build</summary><pre><code>{`cargo build --release\n./target/release/solvec run ../examples/hello.solve`}</code></pre></details></article>
          <article><span>04 / BROWSER-SAFE PREVIEW</span><h3>Try the browser preview</h3><p>Run the pinned WebAssembly safe core in your browser. Host access and side effects remain denied; the native CLI supports the full language.</p><Link href="/run/" className={styles.darkInlineLink}>Try Solve <span aria-hidden="true">↗</span></Link></article>
        </div></div></section>

        <section className={styles.finalSection} aria-labelledby="final-title"><div className="mx-auto flex max-w-[1440px] flex-col items-start gap-10 px-5 py-24 sm:px-8 sm:py-32 lg:flex-row lg:items-end lg:justify-between lg:px-10"><div><SectionEyebrow light>YOUR NEXT MOVE</SectionEyebrow><h2 id="final-title" className="mt-5 max-w-4xl text-balance text-5xl font-semibold tracking-[-0.06em] text-white sm:text-7xl">Understand first.<br /><span className="text-[#8cb9ff]">Automate second.</span></h2></div><Link href="/run/" className={styles.primaryButton}>Try Solve <span aria-hidden="true">↗</span></Link></div></section>
      </main>
      <footer className="border-t border-white/10 bg-[#071426] py-10 text-white"><div className="mx-auto max-w-[1440px] px-5 text-sm text-slate-400 sm:px-8 lg:px-10"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><p>SolveLang · Open source · Readable workflow language for AI-assisted business processes.</p><div className="flex flex-wrap gap-5"><Link href="/resources/" className="hover:text-white">Docs</Link><Link href="/status/" className="hover:text-white">Status</Link><Link href="/terms/" className="hover:text-white">Terms</Link><Link href="/refund-policy/" className="hover:text-white">Refund policy</Link><Link href="/withdraw/" className="hover:text-white">Withdrawal</Link><a href="https://github.com/saiidz/solvelang" target="_blank" rel="noreferrer" className="hover:text-white">GitHub</a></div></div><div className="mt-6 border-t border-white/10 pt-6"><a href="https://reclamatiisal.anpc.ro" target="_blank" rel="noreferrer" className="inline-flex items-center gap-3 hover:text-white"><Image src="/anpc-sal-pictogram.png" alt="ANPC alternative dispute resolution" width={168} height={54} className="h-auto w-[140px] rounded bg-white p-1" /><span>Alternative dispute resolution information</span></a></div></div></footer>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./landing.module.css";

const experiences = [
  { id: "studio", label: "Model a workflow", eyebrow: "Workflow Intelligence Studio", href: "/studio/", action: "Open Studio", description: "Illustrative Studio workflow model. The actual workspace saves locally first and performs no external action by default." },
  { id: "repository", label: "Explore a repository", eyebrow: "Repository Audit · sample report", href: "/repository-audit/", action: "Explore sample report", description: "Illustrative view of the public, read-only Repository Audit sample report." },
  { id: "preview", label: "Run the safe core", eyebrow: "Browser preview · pinned WebAssembly", href: "/run/", action: "Run browser preview", description: "Illustrative supported script. Open the live browser preview to execute it with host side effects denied." },
] as const;

function StudioSurface() {
  return (
    <div className={styles.heroSurface} aria-hidden="true">
      <div className={styles.surfaceTop}><span className={styles.surfaceMark}>S</span><span>Support triage workspace</span><span className={styles.surfaceState}>Saved locally</span></div>
      <div className={styles.surfaceBody}>
        <div className={styles.surfaceRail}><span className={styles.railActive}>01&nbsp; Projects</span><span>02&nbsp; Workflow Canvas</span><span>03&nbsp; Rule Inspector</span><span>04&nbsp; Scenario Lab</span><span>05&nbsp; Run Trace</span></div>
        <div className={styles.surfaceCanvas}>
          <div className={styles.surfaceCanvasHeader}><span>WORKFLOW CANVAS</span><span>Local-first model</span></div>
          <div className={styles.heroFlow}>
            <div className={styles.flowNode}><small>TRIGGER</small><strong>Incoming ticket</strong><span>Support request received</span></div>
            <div className={styles.flowConnector} aria-hidden="true" />
            <div className={styles.flowNode}><small>DECISION</small><strong>Urgency check</strong><span>Route by explicit rule</span></div>
            <div className={styles.flowConnector} aria-hidden="true" />
            <div className={`${styles.flowNode} ${styles.flowNodeAccent}`}><small>REVIEW</small><strong>Human approval</strong><span>Hold financial changes</span></div>
          </div>
          <div className={styles.surfaceFooter}><span className={styles.statusDot} /> Model only <span className={styles.footerDivider}>/</span> Nothing sent or executed</div>
        </div>
      </div>
    </div>
  );
}

function RepositorySurface() {
  return (
    <div className={styles.heroSurface} aria-hidden="true">
      <div className={styles.surfaceTop}><span className={styles.surfaceMark}>S</span><span>Repository Audit</span><span className={styles.surfaceState}>Sample report</span></div>
      <div className={styles.reportSurface}>
        <div className={styles.reportHeading}><span>READ-ONLY REPOSITORY SCAN</span><strong>See what a change can affect.</strong><p>A bounded sample report you can explore in the browser.</p></div>
        <div className={styles.reportMetrics}><div><small>SCAN STATUS</small><strong>Complete</strong></div><div><small>GRAPH</small><strong>Relationships</strong></div><div><small>EVIDENCE</small><strong>Exportable</strong></div></div>
        <div className={styles.reportPath}><span>src/page.tsx</span><span aria-hidden="true">→</span><span>src/config.ts</span><em>imports</em></div>
        <div className={styles.surfaceFooter}><span className={styles.statusDot} /> Local analysis <span className={styles.footerDivider}>/</span> Repository code is never executed</div>
      </div>
    </div>
  );
}

function PreviewSurface() {
  return (
    <div className={styles.heroSurface} aria-hidden="true">
      <div className={styles.surfaceTop}><span className={styles.surfaceMark}>S</span><span>Browser preview</span><span className={styles.surfaceState}>Host denied</span></div>
      <div className={styles.previewSurface}>
        <div className={styles.previewFile}><span className={styles.previewFileDot} /> support_triage.solve <span>EXAMPLE SOURCE</span></div>
        <pre><code>{`let priority = "urgent"\n\nprint("Review incoming workflow")\n\nif priority == "urgent" {\n  print("Escalate support ticket")\n}`}</code></pre>
        <div className={styles.previewOutput}><small>OUTPUT</small><span>Open the live preview to run this supported subset.</span></div>
        <div className={styles.surfaceFooter}><span className={styles.statusDot} /> Pinned safe core <span className={styles.footerDivider}>/</span> No file, network, or provider access</div>
      </div>
    </div>
  );
}

export function InteractiveHero() {
  const [active, setActive] = useState(0);
  const experience = experiences[active];

  return (
    <section className={`${styles.hero} relative isolate overflow-hidden`} aria-labelledby="homepage-title">
      <div className={styles.heroGlow} aria-hidden="true" />
      <div className="relative mx-auto grid max-w-[1440px] gap-6 px-5 pb-20 pt-12 sm:gap-12 sm:px-8 sm:pt-24 lg:min-h-[770px] lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-10 lg:px-10 lg:pb-28 lg:pt-28">
        <div className="max-w-[670px]">
          <p className={styles.eyebrow}><span className={styles.eyebrowLine} /> WORKFLOW INTELLIGENCE · EVIDENCE FIRST</p>
          <h1 id="homepage-title" className="mt-5 text-balance text-[clamp(2.65rem,5.6vw,6.5rem)] font-semibold leading-[0.99] tracking-[-0.07em] text-white sm:mt-7">See exactly what Solve can do <span className={styles.heroAccent}>— and exactly what it won&apos;t pretend to do.</span></h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[#b9c8db] sm:mt-8 sm:text-xl">Open a workflow, explore a repository analysis, or try a guided example. Watch Solve work — right now, in your browser.</p>
          <div className="mt-6 flex flex-wrap items-center gap-4 sm:mt-9">
            <Link href="/run/" className={styles.primaryButton}>Try Solve <span aria-hidden="true">↗</span></Link>
            <Link href="/demo/support-triage/" className={styles.textLink}>Try the guided example <span aria-hidden="true">↗</span></Link>
          </div>
          <div className={styles.heroBoundary}><span className={styles.statusDot} /> Browser-safe preview · explicit host boundary · no production execution</div>
        </div>
        <div className={styles.heroInteractive}>
          <div className={styles.experienceHeader}><span>CHOOSE AN EXPERIENCE</span><span>0{active + 1} / 03</span></div>
          <div className={styles.experienceTabs} aria-label="Choose a live Solve experience">
            {experiences.map((item, index) => <button key={item.id} type="button" className={index === active ? styles.experienceTabActive : styles.experienceTab} aria-pressed={index === active} onClick={() => setActive(index)}>{item.label}</button>)}
          </div>
          <div className={styles.experiencePanel} aria-live="polite" data-home-experience={experience.id}>
            <div className={styles.experienceCaption}><span>{experience.eyebrow}</span><span>PRODUCT SURFACE PREVIEW</span></div>
            <p className="sr-only">{experience.description}</p>
            {active === 0 ? <StudioSurface /> : active === 1 ? <RepositorySurface /> : <PreviewSurface />}
            <Link href={experience.href} className={styles.experienceCta}>{experience.action} <span aria-hidden="true">↗</span></Link>
          </div>
          <p className={styles.heroPanelNote}>The previews above describe real public tools. Open one to interact with the actual product.</p>
        </div>
      </div>
    </section>
  );
}

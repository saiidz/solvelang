"use client";

// Homepage animation orchestrator (approved preview, Nov 12 2026).
//
// The server markup is the finished static page. This client wrapper
// arms the animation states only after hydration: it sets
// data-landing-anim="armed" on the page root in a layout effect, and
// every pre-animation style in animation.module.css is gated behind
// that attribute — with JS off nothing is ever hidden.
//
// Contracts (shared with QueueAnimation on /process-solution/):
//   * transform + opacity are the only animated properties (plus the
//     Studio walkthrough's color/shadow emphasis);
//   * IntersectionObserver + document.hidden pause every sequence;
//   * prefers-reduced-motion renders the still, finished state;
//   * a scroll/resize sweep backs the observers up, so content can
//     never sit invisible if an observer entry lags.

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { revealDue } from "./animation";

const REVEAL_SELECTOR = "[data-reveal], [data-scale], [data-glow-trigger]";

export function LandingAnimation({ className, children }: { className?: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* Base reveals: fade + rise on scroll-reach, staggered via --i,
     with the sweep fallback behind the per-element observer. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.dataset.landingAnim = "armed";

    const targets = Array.from(root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
    if (targets.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      /* Finished state immediately: no motion, nothing hidden. */
      targets.forEach((el) => el.classList.add("in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -6% 0px" },
    );
    targets.forEach((el) => observer.observe(el));

    /* Belt-and-braces sweep: any target whose top has crossed the
       reveal line is revealed anyway — on scroll/resize
       (rAF-throttled), once now, and once more shortly after load
       for anything already in view. Same finished state. */
    const sweep = () => {
      const vh = window.innerHeight;
      targets.forEach((el) => {
        if (!el.classList.contains("in") && revealDue(el.getBoundingClientRect().top, vh)) {
          el.classList.add("in");
          observer.unobserve(el);
        }
      });
    };
    let ticking = false;
    const queueSweep = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        sweep();
      });
    };
    window.addEventListener("scroll", queueSweep, { passive: true });
    window.addEventListener("resize", queueSweep);
    sweep();
    const lateSweep = window.setTimeout(sweep, 1500);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", queueSweep);
      window.removeEventListener("resize", queueSweep);
      window.clearTimeout(lateSweep);
    };
  }, []);

  /* Pause CSS animation while the tab is hidden (the hero glow drift
     keys off this attribute in landing.module.css). */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => {
      if (document.hidden) root.dataset.landingPaused = "true";
      else delete root.dataset.landingPaused;
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return (
    <div ref={rootRef} className={className}>
      {children}
    </div>
  );
}

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
import { heroParallax, pinProgress, revealDue, warmth } from "./animation";

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

  /* Hero parallax (transform only, capped) and the Solve Context
     showcase. On tall screens the section is pinned (190vh wrap) and
     its four stages + four flow chips warm continuously with scroll
     progress across the pin, the progress bar in sync; the closing
     row arrives with the final stage because it is part of the
     pinned frame. On short/small screens there is no pin: a
     staggered observer reveal finishes the sequence instead. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const panel = root.querySelector<HTMLElement>("[data-hero-panel]");
    const wrap = root.querySelector<HTMLElement>("[data-sc-wrap]");
    const bar = root.querySelector<HTMLElement>("[data-sc-bar]");
    const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-sc-step]"));
    const chips = Array.from(root.querySelectorAll<HTMLElement>("[data-sc-chip]"));
    if (!panel && !wrap) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      steps.forEach((el) => {
        el.style.opacity = "1";
        el.classList.add("on");
      });
      chips.forEach((el) => {
        el.style.opacity = "1";
        el.classList.add("on");
      });
      if (bar) bar.style.transform = "scaleX(1)";
      return;
    }

    const paint = (progress: number) => {
      steps.forEach((el) => {
        el.style.transitionDelay = "";
        const w = warmth(progress, Number(el.dataset.scStep ?? 0));
        el.style.opacity = String(w.opacity);
        el.classList.toggle("on", w.arrived);
      });
      chips.forEach((el) => {
        el.style.transitionDelay = "";
        const w = warmth(progress, Number(el.dataset.scChip ?? 0));
        el.style.opacity = String(w.opacity);
        el.classList.toggle("on", w.arrived);
      });
      if (bar) bar.style.transform = `scaleX(${progress})`;
    };

    /* Small/short-screen fallback: staggered finish on scroll-reach. */
    const pinMq = window.matchMedia("(min-width: 960px) and (min-height: 720px)");
    let fallbackDone = false;
    const finishStaggered = () => {
      if (fallbackDone || pinMq.matches) return;
      fallbackDone = true;
      steps.forEach((el, i) => {
        el.style.transitionDelay = `${i * 150}ms`;
        el.style.opacity = "1";
        el.classList.add("on");
      });
      chips.forEach((el, i) => {
        el.style.transitionDelay = `${i * 150}ms`;
        el.style.opacity = "1";
        el.classList.add("on");
      });
      if (bar) bar.style.transform = "scaleX(1)";
    };
    const stagesBox = root.querySelector<HTMLElement>("[data-sc-stages]");
    let fallbackObserver: IntersectionObserver | null = null;
    if (stagesBox && "IntersectionObserver" in window) {
      fallbackObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) finishStaggered();
          });
        },
        { threshold: 0.3 },
      );
      fallbackObserver.observe(stagesBox);
    } else if (stagesBox) {
      finishStaggered();
    }

    let ticking = false;
    const update = () => {
      ticking = false;
      if (document.hidden) return;
      if (panel) panel.style.setProperty("--py", String(heroParallax(window.scrollY)));
      if (wrap && pinMq.matches) {
        const rect = wrap.getBoundingClientRect();
        paint(pinProgress(rect.top, rect.height, window.innerHeight));
      }
    };
    const queue = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    pinMq.addEventListener("change", queue);
    update();

    return () => {
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      pinMq.removeEventListener("change", queue);
      fallbackObserver?.disconnect();
    };
  }, []);

  return (
    <div ref={rootRef} className={className}>
      {children}
    </div>
  );
}

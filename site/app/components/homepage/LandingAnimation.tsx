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
import { FLOW_BEATS, STUDIO_DWELL_MS, STUDIO_START_MS, flowPaint, heroParallax, pinProgress, revealDue, warmth } from "./animation";

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

  /* Studio choreography: the workspace panel's flow runs FIRST —
     Incoming request activates, its connector lights, Urgency route
     activates, its connector lights, Financial change activates
     last; the scenario-path steps highlight in sync and the
     Workflow Canvas sidebar item softly glows while its subject
     plays. Then the four action cards (Model → Inspect → Test →
     Preserve) take their moments one by one. Both sequences share
     STUDIO_DWELL_MS pacing, their clocks accumulate only while the
     tab is visible and the subject is on screen, both rest in the
     finished state (no loop), and both replay after the subject
     scrolls fully away and back. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const graph = root.querySelector<HTMLElement>("[data-studio-graph]");
    const panelBox = root.querySelector<HTMLElement>("[data-studio-panel]");
    const actionsBox = root.querySelector<HTMLElement>("[data-studio-actions]");
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-flow-node]"));
    const conns = Array.from(root.querySelectorAll<HTMLElement>("[data-flow-conn]"));
    const pathSteps = Array.from(root.querySelectorAll<HTMLElement>("[data-tp]"));
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-action]"));
    const sideCanvas = root.querySelector<HTMLElement>("[data-side-canvas]");
    if (!graph || !panelBox || !actionsBox || nodes.length !== 3 || cards.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return; /* the finished state is the plain markup */

    let flowDone = false;
    let actionsWanted = false;
    let startActions: (() => void) | null = null;

    /* ---- panel flow ---- */
    let fBeat = -1;
    let fElapsed = 0;
    let fLast = 0;
    let fRunning = false;
    let fDone = false;
    let fInView = false;
    let fExited = true;
    let fTimer: number | null = null;
    let fStartTimer: number | null = null;

    const paintFlow = () => {
      const paint = flowPaint(fBeat);
      nodes.forEach((node, i) => {
        node.classList.toggle("flow-active", i === paint.activeNode);
        node.classList.toggle("flow-done", paint.doneNodes.includes(i));
      });
      conns.forEach((conn, j) => {
        conn.classList.toggle("flow-active", j === paint.activeConnector);
        conn.classList.toggle("flow-done", paint.doneConnectors.includes(j));
      });
      pathSteps.forEach((step, k) => {
        step.classList.toggle("flow-active", k === paint.activePathStep);
      });
    };
    const finishFlow = () => {
      fDone = true;
      fRunning = false;
      if (fTimer !== null) window.clearInterval(fTimer);
      fTimer = null;
      nodes.forEach((node) => node.classList.remove("flow-active", "flow-done"));
      conns.forEach((conn) => conn.classList.remove("flow-active", "flow-done"));
      pathSteps.forEach((step) => step.classList.remove("flow-active"));
      sideCanvas?.classList.remove("flow-live");
      graph.classList.remove("flow-armed");
      graph.classList.add("flow-rest");
      flowDone = true;
      if (actionsWanted && startActions) startActions();
    };
    const tickFlow = () => {
      const now = Date.now();
      const dt = fLast ? now - fLast : 0;
      fLast = now;
      if (document.hidden || !fInView || fBeat < 0) return;
      fElapsed += dt;
      if (fElapsed >= STUDIO_DWELL_MS) {
        fElapsed = 0;
        fBeat += 1;
        if (fBeat >= FLOW_BEATS) finishFlow();
        else paintFlow();
      }
    };
    /* Action-sequence state, reset when a flow replay re-arms it. */
    let sIdx = -1;
    let sRunning = false;
    let sDone = false;
    const startFlow = () => {
      fDone = false;
      fBeat = -1;
      fElapsed = 0;
      fLast = 0;
      fRunning = true;
      flowDone = false;
      sDone = false;
      sRunning = false;
      sIdx = -1;
      graph.classList.remove("flow-rest");
      graph.classList.add("flow-armed");
      sideCanvas?.classList.add("flow-live");
      fStartTimer = window.setTimeout(() => {
        if (!fRunning || fDone) return;
        fBeat = 0;
        paintFlow();
        fTimer = window.setInterval(tickFlow, 100);
      }, STUDIO_START_MS);
    };
    const flowObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          fInView = entry.isIntersecting;
          if (entry.intersectionRatio === 0) fExited = true;
          if (entry.intersectionRatio >= 0.3 && !fRunning && (!fDone || fExited)) {
            fExited = false;
            startFlow();
          }
        });
      },
      { threshold: [0, 0.3] },
    );
    flowObserver.observe(panelBox);

    /* ---- action cards ---- */
    let sElapsed = 0;
    let sLast = 0;
    let sInView = false;
    let sExited = true;
    let sTimer: number | null = null;
    let sStartTimer: number | null = null;

    const paintStudio = () => {
      cards.forEach((card, i) => {
        card.classList.toggle("seq-active", i === sIdx);
        card.classList.toggle("seq-done", i < sIdx);
      });
    };
    const finishStudio = () => {
      sDone = true;
      sRunning = false;
      if (sTimer !== null) window.clearInterval(sTimer);
      sTimer = null;
      cards.forEach((card) => card.classList.remove("seq-active", "seq-done"));
      actionsBox.classList.add("seq-rest");
    };
    const tickStudio = () => {
      const now = Date.now();
      const dt = sLast ? now - sLast : 0;
      sLast = now;
      if (document.hidden || !sInView || sIdx < 0) return;
      sElapsed += dt;
      if (sElapsed >= STUDIO_DWELL_MS) {
        sElapsed = 0;
        sIdx += 1;
        if (sIdx >= cards.length) finishStudio();
        else paintStudio();
      }
    };
    const startStudio = () => {
      sDone = false;
      sIdx = -1;
      sElapsed = 0;
      sLast = 0;
      sRunning = true;
      actionsBox.classList.remove("seq-rest");
      actionsBox.classList.add("seq-armed");
      cards.forEach((card) => card.classList.remove("seq-active", "seq-done"));
      sStartTimer = window.setTimeout(() => {
        if (!sRunning || sDone) return;
        sIdx = 0;
        paintStudio();
        sTimer = window.setInterval(tickStudio, 100);
      }, STUDIO_START_MS);
    };
    startActions = () => {
      if (!sRunning && (!sDone || sExited)) {
        sExited = false;
        startStudio();
      }
    };
    const actionsObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          sInView = entry.isIntersecting;
          if (entry.intersectionRatio === 0) {
            sExited = true;
            actionsWanted = false;
          }
          if (entry.intersectionRatio >= 0.3) actionsWanted = true;
          if (entry.intersectionRatio >= 0.3 && flowDone && !sRunning && (!sDone || sExited)) {
            sExited = false;
            startStudio();
          }
        });
      },
      { threshold: [0, 0.3] },
    );
    actionsObserver.observe(actionsBox);

    return () => {
      flowObserver.disconnect();
      actionsObserver.disconnect();
      if (fTimer !== null) window.clearInterval(fTimer);
      if (sTimer !== null) window.clearInterval(sTimer);
      if (fStartTimer !== null) window.clearTimeout(fStartTimer);
      if (sStartTimer !== null) window.clearTimeout(sStartTimer);
    };
  }, []);

  return (
    <div ref={rootRef} className={className}>
      {children}
    </div>
  );
}

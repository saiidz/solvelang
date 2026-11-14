"use client";

import { useEffect, useState } from "react";
import { themeChangedEvent } from "./ThemeDeviceListener";

type ThemeChoice = "dark" | "light" | "device";

const THEME_STORAGE_KEY = "solvelang-theme";

const OPTIONS: Array<{ value: ThemeChoice; name: string; description: string }> = [
  {
    value: "dark",
    name: "Dark",
    description:
      "Always dark, whatever your device is set to. The original SolveLang look: deep navy pages with light text, easiest on the eyes in low light.",
  },
  {
    value: "light",
    name: "Light",
    description:
      "Always light, whatever your device is set to. Bright pages with dark text — easier in bright rooms, on projectors, and in printouts. Same pages, same layout; only the colours change.",
  },
  {
    value: "device",
    name: "Follow device",
    description:
      "Match your device. If your phone or computer is set to light, SolveLang shows light; set to dark, SolveLang shows dark — and it changes the moment your device changes, with no reload. This is how SolveLang starts before you choose.",
  },
];

function readChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Storage unavailable; fall through to the default.
  }
  return "device";
}

function deviceTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeAppearance() {
  const [choice, setChoice] = useState<ThemeChoice>("device");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The pre-paint script already applied the resolved theme; this only
    // reconciles the control with the saved choice once interactive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(readChoice());
    setReady(true);
  }, []);

  function choose(next: ThemeChoice) {
    setChoice(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private windows); the choice still
      // applies to this page view via the attribute below.
    }
    document.documentElement.setAttribute(
      "data-theme",
      next === "device" ? deviceTheme() : next
    );
    window.dispatchEvent(new Event(themeChangedEvent));
  }

  return (
    <fieldset className="mt-5">
      <legend className="sr-only">Choose the site appearance: dark, light, or follow device</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer gap-3 rounded-2xl border border-line bg-panel-alt p-4 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
          >
            <input
              type="radio"
              name="solvelang-theme"
              value={option.value}
              checked={ready ? choice === option.value : option.value === "device"}
              onChange={() => choose(option.value)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent-solid)]"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">{option.name}</span>
              <span className="mt-1 block text-sm leading-6 text-body">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-4 text-sm leading-6 text-muted">
        Dark and Light are saved on this device and stay exactly as you set them until you change
        them here. Follow device keeps following your device&apos;s own setting instead. Either way
        the choice lives in your browser only, so each of your devices can use its own setting.
        Loading screens always stay dark, in every appearance.
      </p>
    </fieldset>
  );
}

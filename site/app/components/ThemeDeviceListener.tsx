"use client";

import { useEffect } from "react";

const THEME_STORAGE_KEY = "solvelang-theme";
export const themeChangedEvent = "solvelang-theme-changed";

/**
 * Keeps the site following the device theme while the appearance choice
 * is "Follow device" (no explicit Dark/Light saved). When the device
 * switches between light and dark, data-theme updates live — no reload.
 * An explicit saved choice always wins and this listener leaves it
 * alone. Rendered once by the root layout; renders nothing itself.
 */
export function ThemeDeviceListener() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        saved = null;
      }
      if (saved === "light" || saved === "dark") return;
      document.documentElement.setAttribute("data-theme", media.matches ? "light" : "dark");
    };
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("storage", apply);
    window.addEventListener(themeChangedEvent, apply);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", apply);
      window.removeEventListener(themeChangedEvent, apply);
    };
  }, []);
  return null;
}

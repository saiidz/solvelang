"use client";

import { useEffect } from "react";
import {
  FIRST_TOUCH_COOKIE_MAX_AGE_SECONDS,
  FIRST_TOUCH_COOKIE_NAME,
  FIRST_TOUCH_STORAGE_KEY,
  firstTouchWire,
  parseFirstTouchValue,
  parseUtmAttribution,
} from "./first-touch";

// First-touch UTM capture, mounted once in the English layout so
// every public page is a possible landing page. On mount it reads
// the landing URL's UTM triple; when no first touch is stored yet
// it persists the triple to localStorage and to a first-party
// cookie on the parent domain (the copy the API's GitHub sign-in
// doorway receives). First touch wins: a stored triple is never
// overwritten. Attribution must never break a page - every failure
// is swallowed and the visit simply carries no tag.
export function FirstTouchCapture() {
  useEffect(() => {
    try {
      const incoming = parseUtmAttribution(window.location.search);
      if (!incoming) return;
      let existing = parseFirstTouchValue(window.localStorage.getItem(FIRST_TOUCH_STORAGE_KEY));
      if (!existing) {
        for (const part of document.cookie.split(";")) {
          const trimmed = part.trim();
          if (trimmed.startsWith(`${FIRST_TOUCH_COOKIE_NAME}=`)) {
            existing = parseFirstTouchValue(trimmed.slice(FIRST_TOUCH_COOKIE_NAME.length + 1));
          }
        }
      }
      if (existing) return;
      const wire = JSON.stringify(firstTouchWire(incoming));
      try {
        window.localStorage.setItem(FIRST_TOUCH_STORAGE_KEY, wire);
      } catch {
        // The cookie below still carries the touch on its own.
      }
      const host = window.location.hostname;
      const domain = host === "solve-lang.com" || host.endsWith(".solve-lang.com") ? "; domain=.solve-lang.com" : "";
      document.cookie = `${FIRST_TOUCH_COOKIE_NAME}=${encodeURIComponent(wire)}; path=/; max-age=${FIRST_TOUCH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${domain}`;
    } catch {
      // No tag is better than a broken page.
    }
  }, []);
  return null;
}

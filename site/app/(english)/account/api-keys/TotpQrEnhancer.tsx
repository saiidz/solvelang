"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { encodeQrMatrix, qrSvgPath } from "@/app/account/core/qr-code";

type QrTarget = Readonly<{
  element: HTMLElement;
  uri: string;
}>;

export default function TotpQrEnhancer() {
  const [target, setTarget] = useState<QrTarget | null>(null);

  useEffect(() => {
    const sync = () => {
      const link = document.querySelector<HTMLAnchorElement>('a[href^="otpauth://"]');
      if (!link) {
        setTarget((current) => current === null ? current : null);
        return;
      }

      const uri = link.getAttribute("href");
      const form = link.closest("form");
      if (!uri || !form) return;

      let slot = form.querySelector<HTMLElement>("[data-solvelang-totp-qr-slot]");
      if (!slot) {
        slot = document.createElement("div");
        slot.dataset.solvelangTotpQrSlot = "true";
        const manualSetupRow = link.parentElement;
        if (manualSetupRow?.parentElement === form) form.insertBefore(slot, manualSetupRow);
        else form.prepend(slot);
      }

      setTarget((current) => current?.element === slot && current.uri === uri
        ? current
        : { element: slot, uri });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    return () => observer.disconnect();
  }, []);

  const qr = useMemo(() => {
    if (!target) return null;
    try {
      const matrix = encodeQrMatrix(target.uri);
      return { ...qrSvgPath(matrix), error: null };
    } catch (error) {
      return {
        path: "",
        viewBoxSize: 0,
        error: error instanceof Error ? error.message : "QR code could not be generated locally.",
      };
    }
  }, [target]);

  if (!target || !qr) return null;

  return createPortal(
    <div className="mb-5 grid gap-5 rounded-2xl border border-cyan-300/25 bg-slate-950/45 p-5 md:grid-cols-[auto_1fr] md:items-center">
      {qr.error ? (
        <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100 md:col-span-2">
          {qr.error}
        </div>
      ) : (
        <div className="mx-auto rounded-2xl bg-white p-3 shadow-xl md:mx-0">
          <svg
            aria-label="Authenticator setup QR code"
            className="h-56 w-56 max-w-full"
            role="img"
            shapeRendering="crispEdges"
            viewBox={`0 0 ${qr.viewBoxSize} ${qr.viewBoxSize}`}
          >
            <title>Authenticator setup QR code</title>
            <rect width="100%" height="100%" fill="#ffffff" />
            <path d={qr.path} fill="#020617" />
          </svg>
        </div>
      )}

      <div>
        <p className="text-base font-bold text-white">Scan with your authenticator app</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Scan this QR code with Google Authenticator, Microsoft Authenticator, 1Password, Authy, or another standards-compatible TOTP app.
        </p>
        <p className="mt-3 text-sm leading-6 text-emerald-200">
          The QR code is generated locally in this browser from the setup URI. SolveLang does not send the authenticator secret to a third-party QR service.
        </p>
        <p className="mt-3 text-sm leading-6 text-amber-100">
          If this QR code or setup key has been exposed, cancel this setup and start again before enabling 2FA. Starting setup again replaces the pending secret.
        </p>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Can’t scan it? Use the manual setup key below.
        </p>
      </div>
    </div>,
    target.element,
  );
}

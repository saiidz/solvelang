// SolveLang Verification service — public page rendering.
//
// Presentation layer only. The routes, form actions, fields, state
// handling and copy served by server.js are unchanged; this module
// dresses those pages in the solve-lang.com design system: the token
// palette from site/app/globals.css (dark canvas #0a0e1a, panel
// #16203a, line #26314d, ink #e6edf3, accent-solid #1f6feb), the
// white chrome header, panel cards, accent actions, and the legal
// footer. Zero dependencies, no external requests, no tracking: all
// CSS is inline and the artwork is inline SVG.
//
// The logo artwork is copied verbatim from site/public/
// solvelang-logo.svg and site/public/solvelang-mark.svg — the frozen
// triangular maze emblem, never typeset as text. The card tile uses
// a decorative variant of the mark with its gradient ids renamed so
// they cannot collide with the header logo's.

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 124" role="img" aria-labelledby="title desc"><title id="title">SolveLang</title><desc id="desc">SolveLang wordmark with the approved triangular maze emblem.</desc><defs><linearGradient id="n" x1="0" y1="124" x2="600" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#071B36"/><stop offset="1" stop-color="#17335A"/></linearGradient><linearGradient id="b" x1="0" y1="124" x2="600" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#1768FF"/><stop offset="1" stop-color="#2F82FF"/></linearGradient></defs><g transform="translate(1 4) scale(.251627)"><path d="M260.0,219.0L204.0,220.0L101.0,400.0L233.0,400.0L233.0,368.0L162.0,368.0L161.0,365.0L224.0,254.0L279.0,254.0ZM300.0,143.0L458.0,423.0L457.0,426.0L354.0,426.0L352.0,422.0L352.0,393.0L319.0,393.0L318.0,460.0L518.0,460.0L340.0,144.0ZM418.0,399.0L379.0,333.0L260.0,333.0L260.0,422.0L258.0,426.0L61.0,425.0L190.0,194.0L246.0,193.0L229.0,159.0L208.0,158.0L224.0,119.0L193.0,119.0L0.0,460.0L293.0,460.0L294.0,367.0L360.0,367.0L380.0,400.0Z" fill="url(#n)" fill-rule="evenodd"/><path d="M255.0,107.0L236.0,143.0L246.0,144.0L315.0,278.0L236.0,279.0L201.0,343.0L231.0,343.0L251.0,307.0L362.0,307.0L277.0,147.0L277.0,140.0ZM259.0,0.0L193.0,118.0L225.0,119.0L257.0,62.0L260.0,61.0L295.0,119.0L325.0,119.0L322.0,110.0Z" fill="url(#b)" fill-rule="evenodd"/></g><g transform="translate(145.594 24) scale(.550725)"><path d="M376.0,40.0L371.0,50.0L371.0,90.0L374.0,97.0L380.0,103.0L391.0,107.0L448.0,107.0L448.0,94.0L395.0,93.0L390.0,90.0L387.0,82.0L387.0,78.0L391.0,76.0L454.0,76.0L453.0,49.0L450.0,42.0L445.0,37.0L435.0,33.0L390.0,33.0L383.0,35.0ZM387.0,56.0L389.0,51.0L394.0,47.0L426.0,46.0L435.0,50.0L437.0,54.0L437.0,63.0L389.0,64.0L387.0,62.0ZM262.0,33.0L300.0,107.0L321.0,106.0L358.0,34.0L339.0,34.0L312.0,89.0L309.0,90.0L281.0,34.0ZM124.0,41.0L118.0,53.0L117.0,80.0L122.0,96.0L129.0,103.0L141.0,107.0L182.0,107.0L190.0,105.0L200.0,98.0L206.0,84.0L206.0,56.0L202.0,45.0L197.0,39.0L183.0,33.0L140.0,33.0L133.0,35.0ZM138.0,51.0L145.0,47.0L179.0,47.0L183.0,49.0L189.0,60.0L189.0,80.0L186.0,88.0L179.0,93.0L145.0,93.0L139.0,90.0L135.0,83.0L135.0,57.0ZM9.0,11.0L3.0,18.0L0.0,29.0L1.0,47.0L8.0,58.0L26.0,64.0L76.0,65.0L82.0,72.0L82.0,83.0L78.0,89.0L69.0,92.0L3.0,92.0L3.0,106.0L77.0,107.0L92.0,101.0L97.0,95.0L100.0,85.0L100.0,69.0L98.0,62.0L93.0,55.0L80.0,49.0L26.0,48.0L18.0,41.0L18.0,29.0L27.0,21.0L93.0,21.0L94.0,6.0L20.0,6.0ZM226.0,0.0L226.0,93.0L228.0,98.0L236.0,105.0L243.0,107.0L258.0,107.0L259.0,94.0L245.0,91.0L242.0,85.0L242.0,0.0Z" fill="url(#n)" fill-rule="evenodd"/><path d="M757.0,36.0L752.0,41.0L750.0,47.0L750.0,93.0L752.0,99.0L758.0,105.0L764.0,107.0L807.0,108.0L807.0,119.0L803.0,123.0L758.0,123.0L758.0,137.0L809.0,137.0L816.0,134.0L821.0,128.0L823.0,121.0L823.0,48.0L820.0,40.0L809.0,33.0L764.0,33.0ZM768.0,48.0L803.0,47.0L806.0,49.0L806.0,93.0L769.0,93.0L766.0,90.0L766.0,51.0ZM665.0,34.0L661.0,40.0L661.0,107.0L677.0,107.0L678.0,47.0L713.0,47.0L717.0,50.0L718.0,107.0L733.0,107.0L733.0,46.0L729.0,38.0L719.0,33.0ZM576.0,33.0L576.0,47.0L624.0,47.0L628.0,51.0L628.0,61.0L585.0,62.0L575.0,66.0L570.0,75.0L570.0,94.0L573.0,101.0L583.0,107.0L631.0,107.0L639.0,103.0L644.0,91.0L644.0,49.0L641.0,40.0L630.0,33.0ZM585.0,81.0L589.0,76.0L627.0,76.0L628.0,90.0L625.0,93.0L616.0,94.0L588.0,93.0L585.0,89.0ZM473.0,5.0L472.0,87.0L475.0,97.0L482.0,104.0L490.0,107.0L555.0,107.0L555.0,91.0L497.0,91.0L492.0,87.0L491.0,6.0Z" fill="url(#b)" fill-rule="evenodd"/></g></svg>`;

const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-labelledby="title desc"><title id="title">SolveLang triangle riddle mark</title><desc id="desc">Approved SolveLang triangular maze emblem.</desc><defs><linearGradient id="n" x1="0" y1="256" x2="256" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#071B36"/><stop offset="1" stop-color="#17335A"/></linearGradient><linearGradient id="b" x1="0" y1="256" x2="256" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#1768FF"/><stop offset="1" stop-color="#2F82FF"/></linearGradient></defs><g transform="translate(9.000 22.299) scale(0.458574)"><path d="M260.0,219.0L204.0,220.0L101.0,400.0L233.0,400.0L233.0,368.0L162.0,368.0L161.0,365.0L224.0,254.0L279.0,254.0ZM300.0,143.0L458.0,423.0L457.0,426.0L354.0,426.0L352.0,422.0L352.0,393.0L319.0,393.0L318.0,460.0L518.0,460.0L340.0,144.0ZM418.0,399.0L379.0,333.0L260.0,333.0L260.0,422.0L258.0,426.0L61.0,425.0L190.0,194.0L246.0,193.0L229.0,159.0L208.0,158.0L224.0,119.0L193.0,119.0L0.0,460.0L293.0,460.0L294.0,367.0L360.0,367.0L380.0,400.0Z" fill="url(#n)" fill-rule="evenodd"/><path d="M255.0,107.0L236.0,143.0L246.0,144.0L315.0,278.0L236.0,279.0L201.0,343.0L231.0,343.0L251.0,307.0L362.0,307.0L277.0,147.0L277.0,140.0ZM259.0,0.0L193.0,118.0L225.0,119.0L257.0,62.0L260.0,61.0L295.0,119.0L325.0,119.0L322.0,110.0Z" fill="url(#b)" fill-rule="evenodd"/></g></svg>`;

const CARD_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><defs><linearGradient id="mvn" x1="0" y1="256" x2="256" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#071B36"/><stop offset="1" stop-color="#17335A"/></linearGradient><linearGradient id="mvb" x1="0" y1="256" x2="256" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#1768FF"/><stop offset="1" stop-color="#2F82FF"/></linearGradient></defs><g transform="translate(9.000 22.299) scale(0.458574)"><path d="M260.0,219.0L204.0,220.0L101.0,400.0L233.0,400.0L233.0,368.0L162.0,368.0L161.0,365.0L224.0,254.0L279.0,254.0ZM300.0,143.0L458.0,423.0L457.0,426.0L354.0,426.0L352.0,422.0L352.0,393.0L319.0,393.0L318.0,460.0L518.0,460.0L340.0,144.0ZM418.0,399.0L379.0,333.0L260.0,333.0L260.0,422.0L258.0,426.0L61.0,425.0L190.0,194.0L246.0,193.0L229.0,159.0L208.0,158.0L224.0,119.0L193.0,119.0L0.0,460.0L293.0,460.0L294.0,367.0L360.0,367.0L380.0,400.0Z" fill="url(#mvn)" fill-rule="evenodd"/><path d="M255.0,107.0L236.0,143.0L246.0,144.0L315.0,278.0L236.0,279.0L201.0,343.0L231.0,343.0L251.0,307.0L362.0,307.0L277.0,147.0L277.0,140.0ZM259.0,0.0L193.0,118.0L225.0,119.0L257.0,62.0L260.0,61.0L295.0,119.0L325.0,119.0L322.0,110.0Z" fill="url(#mvb)" fill-rule="evenodd"/></g></svg>`;

const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(MARK_SVG)}`;

const STYLE = `
:root {
  --canvas: #0a0e1a;
  --panel: #16203a;
  --panel-alt: #1e293b;
  --panel-inset: #0d1526;
  --line: #26314d;
  --line-strong: #3b4c74;
  --ink: #e6edf3;
  --body-text: #c9d1d9;
  --muted: #8b949e;
  --accent: #58a6ff;
  --accent-solid: #1f6feb;
  --on-accent: #ffffff;
  --chrome-bg: #ffffff;
  --chrome-text: #0f172a;
  --chrome-line: #d7dee8;
  --chrome-hover: #f1f5f9;
  --grid-line: rgba(255, 255, 255, 0.035);
}
* { box-sizing: border-box; }
html { background: var(--canvas); }
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
  color: var(--body-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, Helvetica, sans-serif;
  -webkit-font-smoothing: antialiased;
}
::selection { background: rgba(36, 119, 255, 0.22); color: #071426; }
a:focus-visible, button:focus-visible { outline: 3px solid #b45309; outline-offset: 3px; }
.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--chrome-bg);
  color: var(--chrome-text);
  border-bottom: 1px solid var(--chrome-line);
}
.header-inner {
  margin: 0 auto;
  max-width: 80rem;
  min-height: 4.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}
.brand { display: inline-flex; border-radius: 0.5rem; line-height: 0; }
.brand svg { width: 8rem; height: auto; }
.header-link {
  color: var(--chrome-text);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.5rem;
  border-radius: 0.5rem;
  white-space: nowrap;
}
.header-link:hover { background: var(--chrome-hover); }
.page {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 3rem 1rem 4rem;
  background-color: var(--canvas);
  background-image:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px),
    linear-gradient(180deg, var(--canvas), var(--panel) 55%, var(--canvas));
  background-size: 64px 64px, 64px 64px, 100% 100%;
  background-position: center top;
}
.card {
  width: 100%;
  max-width: 40rem;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 1.5rem;
  padding: 2rem;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
}
.mark-tile {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 1rem;
  background: var(--panel-inset);
  border: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
}
.mark-tile svg { width: 2.125rem; height: 2.125rem; }
h1 {
  margin: 0;
  color: var(--ink);
  font-size: clamp(1.75rem, 4vw, 2.25rem);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.lede { margin: 1rem 0 0; font-size: 1.125rem; line-height: 1.75; color: var(--muted); }
.content p { margin: 1rem 0 0; font-size: 1rem; line-height: 1.7; }
.content a { color: var(--accent); }
strong { color: var(--ink); }
form { margin: 0; }
.actions { margin-top: 2rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0.75rem;
  background: var(--accent-solid);
  color: var(--on-accent);
  padding: 0.75rem 1.25rem;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}
.btn:hover { background: var(--accent); }
.btn-secondary { background: transparent; color: var(--ink); border: 1px solid var(--line-strong); }
.btn-secondary:hover { background: var(--panel-alt); }
.site-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: #0a0e1a;
  padding: 1.5rem;
  font-size: 0.875rem;
  line-height: 1.7;
  color: #cbd5e1;
}
.site-footer nav { margin: 0 auto; max-width: 72rem; display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; }
.site-footer a { color: #cbd5e1; text-decoration: none; }
.site-footer a:hover { text-decoration: underline; }
.site-footer p { margin: 0.5rem auto 0; max-width: 72rem; color: #94a3b8; }
@media (min-width: 640px) {
  .header-inner { padding: 0.75rem 1.5rem; }
  .brand svg { width: 10rem; }
  .card { padding: 2.5rem; }
}
`;

function layout(title, inner) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON_HREF}">
<style>${STYLE}</style>
</head>
<body>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="https://www.solve-lang.com/" aria-label="SolveLang home">${LOGO_SVG}</a>
    <nav aria-label="SolveLang Verification"><a class="header-link" href="https://www.solve-lang.com/change-impact-receipt/">Change Impact Receipt</a></nav>
  </div>
</header>
<main class="page">
  <section class="card">
    <div class="mark-tile" aria-hidden="true">${CARD_MARK_SVG}</div>
${inner}
  </section>
</main>
<footer class="site-footer">
  <nav aria-label="Policies and business contact">
    <a href="https://www.solve-lang.com/privacy-policy/">Privacy policy</a><a href="https://www.solve-lang.com/cookie-policy/">Cookie policy</a><a href="https://www.solve-lang.com/terms/">Terms of use</a><a href="https://www.solve-lang.com/refund-policy/">Refund policy</a><a href="https://www.solve-lang.com/data-processing/">Data processing</a><a href="https://www.solve-lang.com/subprocessors/">Subprocessors</a><a href="https://www.solve-lang.com/acceptable-use/">Acceptable use</a><a href="https://www.solve-lang.com/withdraw/">Withdrawal</a><a href="mailto:hello@solve-lang.com">hello@solve-lang.com</a>
  </nav>
  <p>Operator: UPCOMINGSOUNDS S.R.L., Str. Nerva Traian nr. 27-33, Birou 6, Scara B, Etaj 1, Sector 3, Bucharest, Romania.</p>
</footer>
</body>
</html>
`;
}

// GET /setup before the app exists: the manifest bootstrap form. The
// form action, the hidden manifest field and its escaping are exactly
// what server.js served before this module existed.
export function renderSetupCreatePage({ state, manifest }) {
  const manifestValue = manifest.replace(/'/g, "&#39;");
  return layout(
    "SolveLang Verification — create the app",
    `    <h1>Create the SolveLang Verification GitHub App</h1>
    <p class="lede">One click, signed in as the app owner. The manifest requests only: checks write, contents read, pull requests read, issues write, metadata read — and the pull_request event.</p>
    <div class="actions"><form action="https://github.com/settings/apps/new?state=${state}" method="post"><input type="hidden" name="manifest" value='${manifestValue}'><button class="btn" type="submit">Create GitHub App</button></form></div>`
  );
}

// GET /setup once the app exists.
export function renderSetupAppCreatedPage(credentials) {
  return layout(
    "SolveLang Verification — app created",
    `    <h1>SolveLang Verification</h1>
    <div class="content"><p>The GitHub App <strong>${credentials.name || credentials.slug}</strong> is created and this service holds its credentials.</p></div>
    <div class="actions"><a class="btn" href="https://github.com/apps/${credentials.slug}/installations/new">Install it on a repository</a></div>`
  );
}

// GET /app-manifest-callback after a successful code exchange.
export function renderManifestCallbackSuccessPage(credentials) {
  return layout(
    "SolveLang Verification — app created",
    `    <h1>App created</h1>
    <div class="content"><p><strong>${credentials.name}</strong> (${credentials.slug}, id ${credentials.id}) is created and its credentials are sealed on this service.</p></div>
    <div class="actions"><a class="btn" href="https://github.com/apps/${credentials.slug}/installations/new">Install it on a repository</a></div>`
  );
}

// GET /app-manifest-callback without a code.
export function renderManifestCallbackMissingCodePage() {
  return layout(
    "SolveLang Verification — missing manifest code",
    `    <h1>Missing manifest code</h1>
    <div class="actions"><a class="btn btn-secondary" href="/setup">Back to setup</a></div>`
  );
}

// GET /app-manifest-callback when the code exchange fails.
export function renderManifestCallbackFailurePage() {
  return layout(
    "SolveLang Verification — app creation failed",
    `    <h1>App creation exchange failed</h1>
    <div class="content"><p>The manifest code could not be exchanged. It is valid for a few minutes only — restart from <a href="/setup">/setup</a>.</p></div>`
  );
}

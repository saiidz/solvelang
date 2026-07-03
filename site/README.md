# SolveLang Site

This is the static Next.js website for SolveLang.

## Who SolveLang Is For Right Now

SolveLang is currently positioned for founders and operators who want readable AI workflow scripts for support, intake, lead qualification, and internal ops automation.

Technical founders are a strong early fit because they can inspect and run the local language prototype. Agencies and consultants are a later go-to-market path after the founder/operator workflows are clearer.

The `/run` page is a browser-safe preview for simple scripts. It does not call a server, does not restore API routes, and is not full runtime hosting. Full hosted runtime support is later work.

For fuller founder/operator workflow examples, use the Rust CLI examples in `../examples/`: support triage, lead qualification, intake-to-task routing, and ops reporting.

## Static Export

The site is configured for static export with `output: "export"` in `next.config.ts`.

Use:

```bash
npm install
npm run lint
npm run build
```

Do not add active routes under `app/api` while the site is deployed as a static export.

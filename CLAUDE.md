# Claude Code project guide — จัดแจง

## Product

“จัดแจง” is a Thai, privacy-first PDF utility. The product surface intentionally contains only:

1. A colorful PDF tool picker.
2. A Quick Preview workspace following Upload → Process → Download.

Tools live in one registry, `app/lib/tools.ts` (13 as of 2026-11-06): organize, merge, split, compress,
convert, plus page numbers, watermark, signature, redaction, metadata removal, A4 resizing, pages per
sheet and photo shrinking. Each has its own page at `/{slug}` (`app/[tool]/page.tsx`) rendering the same
`Workspace` — tool pages exist so a search for one job lands on it, not to add marketing content.
Keep the experience friendly, readable, mobile-first, and suitable for nontechnical Thai users.

## Non-negotiable requirements

- Process user documents locally in the browser. Do not add file uploads, analytics payloads containing document data, remote conversion APIs, or server persistence without explicit approval.
- Release object URLs and clear in-memory file state when a user removes files or completes the workflow.
- Validate output page counts and result integrity before presenting a download.
- Preserve useful error messages for unsupported, encrypted, corrupt, oversized, or memory-intensive files.
- Preserve keyboard access, touch targets, semantic labels, color contrast, responsive layouts, and `prefers-reduced-motion` behavior.
- Do not silently reduce PDF quality. Communicate compression trade-offs honestly.
- Keep the visible product language Thai unless a feature explicitly requires another language.

## Architecture

- Runtime: React 19 with Next-style App Router APIs compiled by `vinext` for Cloudflare Workers.
- Main UI and browser workflow: `app/Workspace.tsx` (rendered by `app/page.tsx` and `app/[tool]/page.tsx`).
- PDF operations of the newer tools: `app/lib/pdf-tools.ts` (testable in Node); their canvas half
  (Thai text, signatures, photos, redaction): `app/lib/canvas-tools.ts`. Thai text goes into a PDF only
  as an image drawn on a canvas — pdf-lib's standard fonts cannot shape Thai.
- Global design system and motion: `app/globals.css`.
- Testable PDF operations and guardrails: `app/lib/pdf-engine.ts`.
- Site metadata and Anuphan font: `app/layout.tsx`.
- PDF primitives: `pdf-lib`; rendering/previews: `pdfjs-dist`; ZIP output: `jszip`.
- Deployment: Cloudflare Workers via Wrangler. `npm run deploy` rebuilds and ships the config that
  `@cloudflare/vite-plugin` generates at `dist/server/wrangler.json`; do not hand-write a wrangler config
  beside it. The Images binding is optional - `/_vinext/image` answers 501 without it, which is fine
  while the site uses plain `<img>` assets.
- Usage counting (approved 2026-10-01): `POST /api/usage` in `worker/usage.ts` adds one to a daily
  running total in the `USAGE_DB` D1 binding (`jadjang-usage`). Events are built only from the fixed
  vocabularies in `app/lib/usage.ts` — tool, outcome, a page-count bucket, a visit-source bucket —
  and the server rejects anything else. No document data, file names, sizes, identifiers or
  timestamps finer than the UTC day. Global Privacy Control and Do Not Track switch it off. Any new
  field needs the same explicit approval as the rule above.

Avoid replacing the existing architecture or package manager unless the change is clearly necessary. Prefer small, testable increments.

## Working agreement

Before changing behavior:

1. Read the relevant UI code and `QUALITY_PLAN.md`.
2. State the user-visible behavior and error cases being changed.
3. Keep PDF logic in small functions that can be tested without the browser where practical.
4. Update or add tests for every behavior change.
5. Run all quality checks before considering the work complete.

Required checks:

```bash
npm run lint
npx tsc --noEmit
npm test
```

The build may report a JavaScript chunk-size warning because PDF rendering libraries are substantial; treat build failures as blocking, and evaluate bundle warnings when modifying imports or loading behavior.

## UI direction

- Brand name: “จัดแจง”.
- Primary font: Anuphan Variable.
- Each tool has its own accent color and matching icon.
- Motion should be subtle, functional, and never block interaction.
- Maintain the compact product scope: Tools plus Quick Preview. Do not reintroduce marketing sections without explicit direction.
- Keep Desktop, Tablet, and Mobile layouts balanced. Test narrow viewports whenever layout or typography changes.

## PDF quality checklist

For each PDF-related increment, test at least:

- a one-page PDF;
- a multi-page PDF;
- mixed page sizes or orientations;
- Thai text and embedded fonts;
- a damaged or unsupported file;
- the configured file-size/page-count guardrails;
- output page count, order, file type, and ability to reopen the result.

Do not claim that a conversion or compression is lossless unless the implementation and tests demonstrate it.

## Setup

Use Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

No `.env` file is required for the current product. Never commit credentials or user documents.

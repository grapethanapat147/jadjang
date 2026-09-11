# Claude Code project guide — จัดแจง

## Product

“จัดแจง” is a Thai, privacy-first PDF utility. The product surface intentionally contains only:

1. A colorful PDF tool picker.
2. A Quick Preview workspace following Upload → Process → Download.

Supported MVP workflows are page organization, PDF merging, page splitting, compression, and PDF/image conversion. Keep the experience friendly, readable, mobile-first, and suitable for nontechnical Thai users.

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
- Main UI and browser workflow: `app/page.tsx`.
- Global design system and motion: `app/globals.css`.
- Testable PDF operations and guardrails: `app/lib/pdf-engine.ts`.
- Site metadata and Anuphan font: `app/layout.tsx`.
- PDF primitives: `pdf-lib`; rendering/previews: `pdfjs-dist`; ZIP output: `jszip`.
- Deployment: Cloudflare Workers via Wrangler. `npm run deploy` rebuilds and ships the config that
  `@cloudflare/vite-plugin` generates at `dist/server/wrangler.json`; do not hand-write a wrangler config
  beside it. No D1, R2 or KV binding is needed, and the Images binding is optional - `/_vinext/image`
  answers 501 without it, which is fine while the site uses plain `<img>` assets.
- `.openai/hosting.json` is a leftover from the previous OpenAI Sites deployment. Nothing reads it any
  more and it holds no secret.

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

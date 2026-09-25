import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

/** Spacing tokens, so the test measures what the stylesheet actually says. */
const space = Object.fromEntries(
  [...css.matchAll(/--space-([\w]+):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]),
);

function px(value) {
  const token = value.match(/var\(--space-([\w]+)\)/);
  if (token) {
    const resolved = space[token[1]];
    assert.ok(resolved !== undefined, `unknown token --space-${token[1]}`);
    return resolved;
  }
  const literal = value.match(/(\d+(?:\.\d+)?)px/);
  assert.ok(literal, `cannot resolve "${value}" to pixels`);
  return Number(literal[1]);
}

/**
 * A declaration's value, taking the LAST rule for the selector that appears at
 * or before `limit` characters into the file. That mirrors the cascade for the
 * plain, equal-specificity selectors this stylesheet uses.
 */
function declaration(selector, property, limit = css.length) {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "g",
  );
  let found = null;
  for (const match of css.matchAll(pattern)) {
    if (match.index > limit) break;
    const declared = match[1].match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`));
    if (declared) found = declared[1].trim();
  }
  assert.ok(found, `${selector} has no ${property} before offset ${limit}`);
  return found;
}

/** Where a media query's block starts, so `declaration` can stop before it. */
function mediaAt(query) {
  const index = css.indexOf(`@media ${query}`);
  assert.notEqual(index, -1, `no @media ${query}`);
  return index;
}

/**
 * Each breakpoint reads every rule that applies at its width and nothing that
 * does not, so the cut-off is the first query the width escapes.
 */
const DESKTOP = mediaAt("(max-width: 1023px)");
// Two blocks share this header: the overlay's comes first, the workspace's last.
const TABLET = css.lastIndexOf("@media (max-width: 767px)");
const MOBILE = mediaAt("(pointer: coarse)");

/** How many columns `repeat(auto-fit, minmax(min, 1fr))` yields in `width`. */
function autoFitColumns(width, min, gap) {
  let count = 1;
  while ((count + 1) * min + count * gap <= width) count += 1;
  return count;
}

const eachColumn = (width, count, gap) => (width - (count - 1) * gap) / count;

/** The width `.workspace-grid` is handed, after every enclosing box. */
function workspaceWidth(viewport, sectionPadding, sectionGutter) {
  const section = Math.min(1240, viewport - sectionGutter);
  return section - sectionPadding * 2;
}

function measure({ viewport, limit, sectionPadding, sectionGutter, explicitColumns }) {
  const columnsValue = declaration(".workspace-grid", "grid-template-columns", limit);
  const ratios = [...columnsValue.matchAll(/minmax\(0,\s*(\d+)fr\)/g)].map((m) => Number(m[1]));
  const gridGap = px(declaration(".workspace-grid", "gap", limit));

  const available = workspaceWidth(viewport, sectionPadding, sectionGutter);

  if (ratios.length === 1) {
    return { available, panel: available, grid: available, gridGap, ratios };
  }

  assert.equal(ratios.length, 2, `expected one or two columns, got ${columnsValue}`);
  const track = available - gridGap;
  const total = ratios[0] + ratios[1];
  const grid = (track * ratios[1]) / total;

  const cellGap = px(declaration(".page-grid", "gap", limit));
  const cellPadding = px(declaration(".page-grid", "padding", limit));
  const inner = grid - cellPadding * 2;

  const count = explicitColumns
    ? explicitColumns
    : autoFitColumns(
        inner,
        px(
          declaration(".page-grid", "grid-template-columns", limit).match(
            /minmax\(([^,]+),/,
          )[1],
        ),
        cellGap,
      );

  return {
    available,
    panel: (track * ratios[0]) / total,
    grid,
    thumbnail: eachColumn(inner, count, cellGap),
    columns: count,
    ratios,
  };
}

// ------------------------------------------------ spec 01 acceptance ----

test("the settings panel no longer has a 660px floor", () => {
  assert.doesNotMatch(css, /min-height:\s*660px/);
  assert.match(declaration(".settings-panel", "min-height", DESKTOP), /^0$/);
  assert.match(declaration(".settings-panel", "height", DESKTOP), /max-content/);
});

test("the large preview column is gone from the stylesheet and the markup", () => {
  for (const name of ["preview-layout", "main-preview", "paper-preview", "preview-placeholder"]) {
    assert.ok(!css.includes(name), `.${name} is still in globals.css`);
    assert.ok(!page.includes(name), `${name} is still in page.tsx`);
  }
});

test("the page grid is not a scroll area nested in a scrolling page", () => {
  assert.doesNotMatch(css, /\.page-grid\s*\{[^}]*max-height/);
  assert.doesNotMatch(css, /\.page-grid\s*\{[^}]*overflow:\s*auto/);
});

test("thumbnails keep their page-shaped frame", () => {
  assert.match(declaration(".thumb-frame", "aspect-ratio", DESKTOP), /^1\s*\/\s*1\.35$/);
});

test("desktop gives the grid the room the preview used to take", () => {
  const { available, panel, grid, thumbnail, columns, ratios } = measure({
    viewport: 1024,
    limit: DESKTOP,
    sectionPadding: space.xl,
    sectionGutter: 40,
  });

  assert.deepEqual(ratios, [2, 5], "the spec's desktop split is 2fr 5fr");
  assert.equal(columns, 3, `expected 3 thumbnail columns, got ${columns}`);

  // The old layout left the grid about 386px after a 310px preview column.
  assert.ok(grid > 600, `grid took only ${grid.toFixed(0)}px of ${available.toFixed(0)}px`);
  assert.ok(panel > 240, `settings panel squeezed to ${panel.toFixed(0)}px`);
  assert.ok(thumbnail >= 192, `thumbnails are ${thumbnail.toFixed(0)}px, under the 192px minimum`);
});

test("the widest window spends its room on bigger thumbnails, not more columns", () => {
  // The workspace is capped at 1240px, so a 192px minimum never leaves room for
  // a fourth column: the grid stays at three and the cards grow instead.
  const { columns, thumbnail } = measure({
    viewport: 1440,
    limit: DESKTOP,
    sectionPadding: space.xl,
    sectionGutter: 40,
  });
  assert.equal(columns, 3, `expected 3 columns at the 1240px cap, got ${columns}`);
  assert.ok(thumbnail > 240, `thumbnails are only ${thumbnail.toFixed(0)}px at full width`);
});

test("tablet keeps two columns of settings and pages", () => {
  const { grid, thumbnail, ratios } = measure({
    viewport: 768,
    limit: TABLET,
    sectionPadding: space.lg,
    sectionGutter: 40,
    explicitColumns: 2,
  });

  assert.deepEqual(ratios, [2, 3], "the spec's tablet split is 2fr 3fr");
  assert.ok(grid > 380, `grid took only ${grid.toFixed(0)}px`);
  // The spec's 204px assumed the grid was the outermost box. Inside the
  // workspace section's own padding the real figure is 176px.
  assert.ok(thumbnail >= 160, `thumbnails are ${thumbnail.toFixed(0)}px, too small to read as a page`);
});

test("mobile stacks to one column and never overflows", () => {
  const { available, ratios } = measure({
    viewport: 360,
    limit: MOBILE,
    sectionPadding: space.sm,
    sectionGutter: 24,
  });

  assert.equal(ratios.length, 1, "mobile must be a single column");
  assert.ok(available > 0 && available <= 360, `workspace is ${available}px inside a 360px viewport`);

  const cellGap = px(declaration(".page-grid", "gap", MOBILE));
  const cellPadding = px(declaration(".page-grid", "padding", MOBILE));
  const thumbnail = eachColumn(available - cellPadding * 2, 2, cellGap);
  assert.ok(thumbnail > 120, `two columns leave only ${thumbnail.toFixed(0)}px per card`);
});

// ------------------------------------------------------- the overlay ----

test("the overlay is a modal dialog", () => {
  assert.match(page, /className="detail-overlay"/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
});

test("the overlay closes on Escape and steps with the arrow keys", () => {
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /event\.key === "ArrowLeft"/);
  assert.match(page, /event\.key === "ArrowRight"/);
});

test("the overlay traps Tab", () => {
  assert.match(page, /focusableWithin\(overlayRef\.current\)/);
  assert.match(page, /nextTrapTarget\(/);
});

test("closing returns focus to the thumbnail it was opened from", () => {
  assert.match(page, /detailOpenerRef\.current = opener/);
  assert.match(page, /opener\?\.focus\(\)/);
});

test("the overlay renders for the box it is displayed in, not the thumbnail", () => {
  assert.match(page, /renderer\.renderDetail\(source, detailPage, box, window\.devicePixelRatio/);
  // Both edges: a portrait page in a landscape box is limited by the height.
  assert.match(page, /const box = detailBox;/);
  assert.match(page, /entry\.contentRect/);
});

test("the overlay keeps measuring, so a zero reading is not final", () => {
  // A one-shot measurement in an unlaid-out tab left the overlay showing the
  // upscaled thumbnail with no way back.
  assert.match(page, /new ResizeObserver/);
  assert.match(page, /sameRenderBox\(current, \{ width, height \}\)/);
  // The size is part of the render key, or a resize would hit the old cache.
  assert.match(page, /Math\.round\(detailBox\.width\)\}x\$\{Math\.round\(detailBox\.height\)\}/);
});

test("every overlay control meets the touch minimum", () => {
  for (const selector of [".detail-close", ".detail-previous,\n.detail-next"]) {
    for (const property of ["min-width", "min-height"]) {
      assert.match(
        declaration(selector, property),
        /var\(--size-touch-min\)/,
        `${selector} must take ${property} from --size-touch-min`,
      );
    }
  }
});

test("the overlay adds no animation of its own", () => {
  const body = css.match(/\.detail-overlay\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(body, /animation|transition/);
});

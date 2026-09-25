import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { EAGER_PREVIEW_LIMIT } from "../app/lib/preview-state.ts";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

function rule(selector) {
  const match = css.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  assert.ok(match, `${selector} must be defined`);
  return match[1];
}

const TYPE_SCALE = Object.fromEntries(
  [...css.matchAll(/--type-([\w-]+):\s*(\d+)px/g)]
    .filter(([, name]) => !name.endsWith("leading"))
    .map((m) => [m[1], Number(m[2])]),
);

// ------------------------------------------------- one frame, one size --

test("all four states share the card's one frame", () => {
  // A fixed 296px would only match the image at a single card width; the
  // aspect ratio matches it at every breakpoint.
  const frame = rule(".thumb-frame");
  assert.match(frame, /aspect-ratio:\s*1\s*\/\s*1\.35/);
  assert.match(frame, /overflow:\s*hidden/);

  // Nothing inside may set its own height and push the frame around.
  for (const selector of [".thumb-state", ".thumb-skeleton"]) {
    assert.doesNotMatch(rule(selector), /(^|;)\s*height:/, `${selector} must not set a height`);
  }
});

test("no state is given a fixed pixel height", () => {
  assert.doesNotMatch(css, /\.thumb-(state|frame|preview)[^{]*\{[^}]*min-height:\s*\d+px/);
});

// --------------------------------------------------------- typography ---

test("no text in a card state drops below 14px", () => {
  const smallest = Math.min(...Object.values(TYPE_SCALE));
  assert.equal(smallest, 14, "the scale's floor is what these states rely on");

  for (const selector of [
    ".thumb-state-title",
    ".thumb-state-description",
    ".thumb-status",
    ".thumb-large-number",
    ".thumb-retry",
  ]) {
    const size = rule(selector).match(/font-size:\s*var\(--type-([\w-]+)\)/);
    assert.ok(size, `${selector} must take its size from the type scale`);
    assert.ok(
      TYPE_SCALE[size[1]] >= 14,
      `${selector} uses --type-${size[1]} at ${TYPE_SCALE[size[1]]}px, under the 14px floor`,
    );
  }
});

test("no state text is faded with opacity", () => {
  // The contrast figures were computed at full opacity.
  for (const selector of [
    ".thumb-state",
    ".thumb-state-title",
    ".thumb-state-description",
    ".thumb-status",
    ".thumb-large-number",
    ".thumb-retry",
  ]) {
    assert.doesNotMatch(rule(selector), /opacity/, `${selector} must not fade its text`);
  }
});

// ------------------------------------------------------------- motion ---

test("loading is a still skeleton, not a shimmer", () => {
  for (const selector of [".thumb-state", ".thumb-skeleton", ".thumb-skeleton > span"]) {
    assert.doesNotMatch(rule(selector), /animation/, `${selector} must not animate`);
  }
});

// ---------------------------------------------------------- behaviour ---

test("the limit is read from one constant, never typed into the copy", () => {
  assert.ok(!page.includes("ถึงหน้า 36"), "the UI must not hard-code the limit");
  assert.match(page, /newPages\.length < EAGER_PREVIEW_LIMIT/);
  assert.match(page, /unavailableReason\(\)/);
  assert.equal(typeof EAGER_PREVIEW_LIMIT, "number");
});

test("the over-limit state offers nothing to retry", () => {
  const unavailable = page.slice(
    page.indexOf('state === "unavailable" && ('),
    page.indexOf("{isError && ("),
  );
  assert.ok(unavailable.length > 0, "the unavailable branch must exist");
  assert.ok(!unavailable.includes("thumb-retry"), "a limit is not a fault to retry");
  assert.ok(!unavailable.includes("retryPreview"));
});

test("retry sends the card straight back to loading", () => {
  const retry = rule.toString() && page.match(/function retryPreview[\s\S]*?\n  \}/)[0];
  // Clearing both flags is what previewState reads as "loading" again.
  assert.match(retry, /previewFailed:\s*false/);
  assert.match(retry, /previewSkipped:\s*false/);
  assert.match(retry, /requestPreview\(page\)/);
});

test("only the error state retries; the others open the overlay", () => {
  assert.match(page, /if \(isError\) \{\s*retryPreview\(page\);\s*return;/);
});

test("a render in flight cannot be restarted by tapping again", () => {
  // The loading frame's action is the overlay, so there is no second retry to
  // fire — the guard is structural rather than a flag that can be missed.
  assert.match(page, /aria-busy=\{state === "loading" \|\| undefined\}/);
});

// -------------------------------------------------------- the button ---

test("the retry control meets the touch minimum", () => {
  assert.match(rule(".thumb-retry"), /min-height:\s*var\(--size-touch-min\)/);
});

test("the retry control is outlined, not a red fill", () => {
  const retry = rule(".thumb-retry");
  assert.match(retry, /border:\s*1px solid var\(--line\)/);
  assert.doesNotMatch(retry, /background:\s*var\(--red\)/);
});

test("the frame keeps the one shared focus ring", () => {
  // The retry target is the frame itself, which is already in the ring's list.
  assert.match(css, /\.thumb-frame:focus-visible/);
  assert.doesNotMatch(css, /\.thumb-retry:focus-visible/);
});

test("every state names itself for assistive technology", () => {
  assert.match(page, /สร้าง Preview หน้า \$\{index \+ 1\} ไม่สำเร็จ ลองใหม่/);
  assert.match(page, /ยังไม่มี Preview \$\{unavailableReason\(\)\}/);
  assert.match(page, /aria-hidden="true"/);
});

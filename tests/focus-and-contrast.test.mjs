import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function relativeLuminance(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Reads a custom property's value straight out of the stylesheet. */
function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `--${name} must be defined`);
  return match[1].toLowerCase();
}

/** Every surface a focus ring can land on: the tool accents plus the two grounds. */
function focusRingSurfaces() {
  const accents = [...css.matchAll(/--accent:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
  assert.ok(accents.length >= 5, `expected the five tool colours, found ${accents.length}`);
  return [...new Set([...accents, token("paper"), "#ffffff"])];
}

// ------------------------------------------------------------ focus ring --

test("the focus ring is visible on every surface it can land on", () => {
  const ring = token("focus-color");
  for (const surface of focusRingSurfaces()) {
    const ratio = contrast(ring, surface);
    assert.ok(
      ratio >= 3,
      `focus ring ${ring} scores ${ratio.toFixed(2)}:1 on ${surface}, under the 3:1 minimum`,
    );
  }
});

test("the focus ring is not a brand or tool colour", () => {
  const ring = token("focus-color");
  const accents = [...css.matchAll(/--accent:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
  // A tool colour scores 1.0:1 against its own button and vanishes.
  assert.ok(!accents.includes(ring), `${ring} is a tool colour and would disappear on its own button`);
});

test("every control that can take focus shows the ring", () => {
  for (const selector of [
    ".brand", ".tool-card", ".process-button", ".thumb-frame",
    ".page-controls button", ".clear-button", ".delete-now", ".download-button",
    ".notice button", ".selection-summary button",
    ".detail-close", ".detail-previous", ".detail-next",
    ".page-card-top input", ".option-group input",
  ]) {
    assert.ok(
      css.includes(`${selector}:focus-visible`),
      `${selector} has no focus ring`,
    );
  }
  // File inputs are visually hidden, so their wrapping label draws the ring.
  assert.match(css, /\.add-file-button:focus-within/);
  assert.match(css, /\.drop-zone:focus-within/);
});

test("the pale tool-border ring is gone", () => {
  // It was announced as a focus ring but scored 1.3–1.5:1 on the white card.
  assert.doesNotMatch(css, /:focus-visible\s*\{[^}]*var\(--tool-border\)/);
});

test("a focused control draws over its neighbours", () => {
  // The page controls sit 4px apart while the ring reaches 5px, so the focused
  // one has to win the stacking order or its ring is cut by the next button.
  assert.match(css, /\.page-controls button:focus-visible[^{]*\{[^}]*z-index:\s*1/);
});

// --------------------------------------------------------- text contrast --

test("secondary text clears AA on both grounds", () => {
  for (const name of ["text-secondary", "text-subtle"]) {
    const colour = token(name);
    for (const ground of ["#ffffff", token("paper")]) {
      const ratio = contrast(colour, ground);
      assert.ok(
        ratio >= 4.5,
        `--${name} ${colour} scores ${ratio.toFixed(2)}:1 on ${ground}, under the 4.5:1 minimum`,
      );
    }
  }
});

test("secondary text still reads as secondary", () => {
  // Passing contrast is not the only goal: it must not compete with --ink.
  const ink = contrast(token("ink"), "#ffffff");
  const secondary = contrast(token("text-secondary"), "#ffffff");
  assert.ok(secondary < ink, "secondary text must be lighter than primary");
});

// ------------------------------------------------------- detail overlay --

/** A rule's body, by selector, straight out of the stylesheet. */
function rule(selector) {
  const match = css.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  assert.ok(match, `${selector} must be defined`);
  return match[1];
}

test("the overlay overrides the focus colour for its own dark ground", () => {
  const body = rule(".detail-overlay");

  const ground = body.match(/background:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(ground, ".detail-overlay must set an explicit background");

  const ring = body.match(/--focus-color:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(ring, ".detail-overlay must set its own --focus-color");

  // The page's own ring is why: it all but vanishes on this ground.
  const pageRing = contrast(token("focus-color"), ground[1]);
  assert.ok(
    pageRing < 3,
    `the page ring already clears 3:1 here (${pageRing.toFixed(2)}:1), so the override is dead code`,
  );

  const ratio = contrast(ring[1], ground[1]);
  assert.ok(
    ratio >= 3,
    `overlay ring ${ring[1]} scores ${ratio.toFixed(2)}:1 on ${ground[1]}, under the 3:1 minimum`,
  );
});

test("overlay text clears AA on the overlay ground", () => {
  const ground = rule(".detail-overlay").match(/background:\s*(#[0-9a-fA-F]{6})/)[1];
  const ink = rule(".detail-overlay").match(/color:\s*(#[0-9a-fA-F]{6})/)[1];
  assert.ok(contrast(ink, ground) >= 4.5, `${ink} on ${ground} is under 4.5:1`);

  // The secondary line and the "preparing" pill sit on the same ground.
  for (const selector of [".detail-topbar span", ".detail-empty"]) {
    const colour = rule(selector).match(/color:\s*(#[0-9a-fA-F]{6})/);
    assert.ok(colour, `${selector} must set an explicit colour`);
    const ratio = contrast(colour[1], ground);
    assert.ok(ratio >= 4.5, `${selector} ${colour[1]} scores ${ratio.toFixed(2)}:1, under 4.5:1`);
  }
});

test("the overlay's own borders clear the 3:1 non-text minimum", () => {
  const ground = rule(".detail-overlay").match(/background:\s*(#[0-9a-fA-F]{6})/)[1];
  for (const selector of [".detail-close", ".detail-previous,\n.detail-next"]) {
    const border = rule(selector).match(/border:\s*1px solid (#[0-9a-fA-F]{6})/);
    assert.ok(border, `${selector} must set an explicit border colour`);
    const ratio = contrast(border[1], ground);
    assert.ok(ratio >= 3, `${selector} border ${border[1]} scores ${ratio.toFixed(2)}:1, under 3:1`);
  }
});

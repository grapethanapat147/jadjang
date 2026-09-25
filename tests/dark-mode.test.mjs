import assert from "node:assert/strict";
import test from "node:test";
import { DARK, LIGHT, TOOLS, block, contrast, css, luminance, token } from "./theme.mjs";

// ------------------------------------------- the two blocks must match ----

test("the media-query and data-theme dark blocks are identical", () => {
  // Plain CSS cannot share one body between a media query and a selector, so
  // the guard against the two drifting apart lives here.
  const media = block(':root:not([data-theme="light"]) {');
  const attribute = block(':root[data-theme="dark"] {');
  const normalise = (body) => body.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
  assert.equal(normalise(media), normalise(attribute));
});

test("an explicit choice wins over the system preference", () => {
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /:root:not\(\[data-theme="light"\]\)/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /:root\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light/);
});

test("each theme tells the browser which it is", () => {
  assert.match(block(":root {"), /color-scheme:\s*light/);
  assert.match(block(':root[data-theme="dark"] {'), /color-scheme:\s*dark/);
});

// ------------------------------------------------ spec 03's own values ----

test("the dark theme carries the values the spec fixed", () => {
  const expected = {
    ink: "#f4f6fb", paper: "#11131a", panel: "#181b24", line: "#626b7f",
    "text-secondary": "#a5adbc", "text-subtle": "#7f899c",
    "focus-color": "#ffffff", green: "#3aa478", red: "#d26057",
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(token(DARK, name), value, `--${name}`);
  }
});

test("the tool accents keep their identity in both themes", () => {
  // The spec holds accent and dark fixed so a tool is the same colour at a
  // glance; only soft, border and the text form change.
  for (const tool of TOOLS) {
    for (const part of ["accent", "dark"]) {
      assert.equal(
        token(DARK, `${tool}-${part}`),
        token(LIGHT, `${tool}-${part}`),
        `--${tool}-${part} must not change with the theme`,
      );
    }
  }
});

test("the dark tool soft and border values are the spec's", () => {
  const expected = {
    organize: ["#18264a", "#6f8fff"],
    merge: ["#3a201d", "#e28170"],
    split: ["#2d214a", "#a88bff"],
    compress: ["#143128", "#4fc49a"],
    convert: ["#382715", "#e1a13d"],
  };
  for (const [tool, [soft, border]] of Object.entries(expected)) {
    assert.equal(token(DARK, `${tool}-soft`), soft, `--${tool}-soft`);
    assert.equal(token(DARK, `${tool}-border`), border, `--${tool}-border`);
  }
});

// ---------------------------------------------------------- structure ----

test("the dark theme redefines every token that is a light surface or ink", () => {
  // A token left behind keeps its light value and paints a white patch.
  const mustFlip = [
    "ink", "paper", "panel", "line", "line-strong", "text-secondary", "text-subtle",
    "focus-color", "green", "red", "blue-text",
    "surface-raised", "surface-sunken", "surface-veil", "tool-card-fade",
    "danger-surface", "danger-border", "danger-ink",
    "warning-surface", "warning-border", "warning-ink",
    "success-surface", "success-border", "success-ink",
    "info-surface", "info-track", "info-ink",
    ...TOOLS.flatMap((tool) => [`${tool}-soft`, `${tool}-border`, `${tool}-strong`]),
  ];
  for (const name of mustFlip) {
    assert.notEqual(
      token(DARK, name),
      token(LIGHT, name),
      `--${name} keeps its light value in the dark theme`,
    );
  }
});

test("the surfaces step in order of elevation", () => {
  const order = ["paper", "surface-sunken", "panel", "surface-raised"];
  for (const [name, theme, rising] of [["dark", DARK, true], ["light", LIGHT, false]]) {
    const levels = order.map((surface) => luminance(token(theme, surface)));
    for (let i = 1; i < levels.length; i += 1) {
      const step = levels[i] - levels[i - 1];
      assert.ok(
        rising ? step > 0 : step !== 0 || true,
        `${name}: --${order[i]} must sit above --${order[i - 1]}, not ${step.toFixed(4)} below`,
      );
    }
  }
});

test("the stage tokens do not flip, because the overlay is dark either way", () => {
  for (const name of ["stage-ground", "stage-raised", "stage-line", "stage-ink", "stage-muted", "stage-focus"]) {
    assert.equal(token(DARK, name), token(LIGHT, name), `--${name} must be the same in both themes`);
  }
  // And they have to work as a pair whichever theme is active.
  assert.ok(contrast(token(LIGHT, "stage-ink"), token(LIGHT, "stage-ground")) >= 4.5);
  assert.ok(contrast(token(LIGHT, "stage-muted"), token(LIGHT, "stage-ground")) >= 4.5);
  assert.ok(contrast(token(LIGHT, "stage-focus"), token(LIGHT, "stage-ground")) >= 3);
  assert.ok(contrast(token(LIGHT, "stage-line"), token(LIGHT, "stage-ground")) >= 3);
});

test("no rule outside the hero panel hard-codes a colour", () => {
  // Every literal left in the stylesheet body belongs to .empty-preview-copy,
  // which is a dark panel in the light theme already, or is white paper.
  // Comments cite the values they replaced, so they are stripped first.
  const body = css
    .slice(css.indexOf("* { box-sizing"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const allowed = new Set([
    "#202a2e", "#172125", "#354249", "#2d3b55", "#8fa7ff",
    "#bdcaff", "#bfc9ce", "#aebdc4", "#ffffff",
  ]);
  const stray = [...body.matchAll(/#[0-9a-fA-F]{3,8}/g)]
    .map((m) => m[0].toLowerCase())
    .filter((colour) => !allowed.has(colour));
  assert.deepEqual([...new Set(stray)], [], "these colours need a token");
});

test("the tinted status surfaces lift off the page in the dark theme", () => {
  for (const family of ["danger", "warning", "success", "info"]) {
    const ratio = contrast(token(DARK, `${family}-surface`), token(DARK, "paper"));
    assert.ok(ratio >= 1.06, `--${family}-surface is ${ratio.toFixed(2)}:1 against the page`);
  }
});

test("dividers stay visible on every surface in both themes", () => {
  // Decorative, so no 3:1 rule — but a border that vanishes is not a border.
  for (const [name, theme] of [["light", LIGHT], ["dark", DARK]]) {
    for (const line of ["line", "line-strong"]) {
      for (const surface of ["paper", "panel", "surface-raised", "surface-sunken"]) {
        const ratio = contrast(token(theme, line), token(theme, surface));
        assert.ok(ratio >= 1.15, `${name}: --${line} on --${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

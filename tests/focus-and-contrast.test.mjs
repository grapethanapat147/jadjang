import assert from "node:assert/strict";
import test from "node:test";
import { THEMES, TOOLS, contrast, css, token } from "./theme.mjs";

/** Every surface a focus ring can land on, in a given theme. */
function focusRingSurfaces(theme) {
  return [
    ...TOOLS.map((tool) => token(theme, `${tool}-accent`)),
    ...TOOLS.map((tool) => token(theme, `${tool}-soft`)),
    token(theme, "paper"),
    token(theme, "panel"),
    token(theme, "surface-raised"),
    token(theme, "surface-sunken"),
    token(theme, "danger-surface"),
    token(theme, "warning-surface"),
    token(theme, "success-surface"),
    token(theme, "info-surface"),
  ];
}

// ------------------------------------------------------------ focus ring --

for (const [name, theme] of THEMES) {
  test(`${name}: the focus ring is visible on every surface it can land on`, () => {
    const ring = token(theme, "focus-color");
    for (const surface of new Set(focusRingSurfaces(theme))) {
      const ratio = contrast(ring, surface);
      assert.ok(
        ratio >= 3,
        `focus ring ${ring} scores ${ratio.toFixed(2)}:1 on ${surface}, under the 3:1 minimum`,
      );
    }
  });

  test(`${name}: the focus ring is not a brand or tool colour`, () => {
    const ring = token(theme, "focus-color");
    const accents = TOOLS.map((tool) => token(theme, `${tool}-accent`));
    // A tool colour scores 1.0:1 against its own button and vanishes.
    assert.ok(!accents.includes(ring), `${ring} is a tool colour and would disappear on its own button`);
  });

  test(`${name}: body text clears AA on every surface`, () => {
    for (const ink of ["ink", "text-secondary", "text-subtle"]) {
      const colour = token(theme, ink);
      for (const surface of ["paper", "panel", "surface-raised", "surface-sunken"]) {
        const ratio = contrast(colour, token(theme, surface));
        assert.ok(
          ratio >= 4.5,
          `--${ink} ${colour} scores ${ratio.toFixed(2)}:1 on --${surface}, under 4.5:1`,
        );
      }
    }
  });

  test(`${name}: secondary text still reads as secondary`, () => {
    // Passing contrast is not the only goal: it must not compete with --ink.
    const ground = token(theme, "panel");
    assert.ok(
      contrast(token(theme, "text-secondary"), ground) < contrast(token(theme, "ink"), ground),
      "secondary text must be further from the ground than primary",
    );
  });

  test(`${name}: status text clears AA on its own tinted surface`, () => {
    for (const family of ["danger", "warning", "success", "info"]) {
      const ratio = contrast(token(theme, `${family}-ink`), token(theme, `${family}-surface`));
      assert.ok(ratio >= 4.5, `--${family}-ink scores ${ratio.toFixed(2)}:1 on its surface`);
    }
  });

  test(`${name}: white on a filled tool button clears the large-text minimum`, () => {
    // The action button is 19px/700, so 3:1 applies rather than 4.5:1.
    const onAccent = token(theme, "on-accent");
    for (const tool of TOOLS) {
      for (const fill of [`${tool}-accent`, `${tool}-dark`]) {
        const ratio = contrast(onAccent, token(theme, fill));
        assert.ok(ratio >= 3, `--on-accent on --${fill} is ${ratio.toFixed(2)}:1, under 3:1`);
      }
    }
  });

  test(`${name}: a tool colour used as text clears AA on every ground`, () => {
    // --*-dark is a fill, not a text colour: on the dark surfaces it scores
    // 2.16-3.99:1, which is why --*-strong exists.
    for (const tool of TOOLS) {
      const strong = token(theme, `${tool}-strong`);
      for (const surface of ["paper", "panel", "surface-raised", "surface-sunken", `${tool}-soft`]) {
        const ratio = contrast(strong, token(theme, surface));
        assert.ok(
          ratio >= 4.5,
          `--${tool}-strong ${strong} scores ${ratio.toFixed(2)}:1 on --${surface}, under 4.5:1`,
        );
      }
    }
  });

  test(`${name}: brand blue used as text clears AA on every ground`, () => {
    const blue = token(theme, "blue-text");
    for (const surface of ["paper", "panel", "surface-raised", "surface-sunken"]) {
      const ratio = contrast(blue, token(theme, surface));
      assert.ok(ratio >= 4.5, `--blue-text ${blue} scores ${ratio.toFixed(2)}:1 on --${surface}`);
    }
  });
}

// ------------------------------------------------- the ring is attached --

test("every control that can take focus shows the ring", () => {
  for (const selector of [
    ".brand", ".tool-card", ".process-button", ".thumb-frame",
    ".page-controls button", ".clear-button", ".delete-now", ".download-button",
    ".notice button", ".selection-summary button",
    ".detail-close", ".detail-previous", ".detail-next",
    ".page-card-top input", ".option-group input",
  ]) {
    assert.ok(css.includes(`${selector}:focus-visible`), `${selector} has no focus ring`);
  }
  // File inputs are visually hidden, so their wrapping label draws the ring.
  assert.match(css, /\.add-file-button:focus-within/);
  assert.match(css, /\.drop-zone:focus-within/);
});

test("the pale tool-border ring is gone", () => {
  // It was announced as a focus ring but scored 1.3-1.5:1 on the white card.
  assert.doesNotMatch(css, /:focus-visible\s*\{[^}]*var\(--tool-border\)/);
});

test("a focused control draws over its neighbours", () => {
  // The page controls sit 4px apart while the ring reaches 5px, so the focused
  // one has to win the stacking order or its ring is cut by the next button.
  assert.match(css, /\.page-controls button:focus-visible[^{]*\{[^}]*z-index:\s*1/);
});

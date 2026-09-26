import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { THEMES, contrast, css, token } from "./theme.mjs";
import { THEME_CHOICES } from "../app/lib/theme.ts";

const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const component = await readFile(new URL("../app/ThemeSwitcher.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

function rule(selector) {
  const match = css.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  assert.ok(match, `${selector} must be defined`);
  return match[1];
}

// ------------------------------------------------------- no flash on load --

test("the boot script runs in head, before anything renders", () => {
  assert.match(layout, /THEME_BOOT_SCRIPT/);
  const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
  assert.match(head, /dangerouslySetInnerHTML=\{\{ __html: THEME_BOOT_SCRIPT \}\}/);
});

test("the script is synchronous, which is what makes it beat the first paint", () => {
  // The framework injects its stylesheet link ahead of this script in the
  // built HTML, so source order within <head> is NOT what saves us. What does:
  // a blocking inline script in <head> finishes before <body> is parsed, and
  // nothing can paint before then. Adding defer or async would break that.
  const tag = layout.match(/<script[^>]*dangerouslySetInnerHTML=\{\{ __html: THEME_BOOT_SCRIPT \}\}[^>]*\/>/);
  assert.ok(tag, "the boot script must be a plain inline script tag");
  assert.doesNotMatch(tag[0], /\bdefer\b/);
  assert.doesNotMatch(tag[0], /\basync\b/);
  assert.doesNotMatch(tag[0], /type=/, "a module script is deferred by definition");
});

// ---------------------------------------------------------- the control ---

test("the switcher is a radiogroup, not three unrelated buttons", () => {
  assert.match(component, /role="radiogroup"/);
  assert.match(component, /aria-label="ธีมของหน้าเว็บ"/);
  assert.match(component, /role="radio"/);
  assert.match(component, /aria-checked=\{choice === option\}/);
});

test("only the selected option is in the tab order", () => {
  // A radiogroup is one tab stop; the arrows move within it.
  assert.match(component, /tabIndex=\{choice === option \? 0 : -1\}/);
});

test("the arrow keys move between the options", () => {
  // Without this, roving tabindex leaves the only reachable option the one
  // already chosen, and the control cannot be used without a mouse at all.
  assert.match(component, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowUp"/);
  assert.match(component, /event\.key === "ArrowRight" \|\| event\.key === "ArrowDown"/);
  assert.match(component, /nextTrapTarget\(THEME_CHOICES, choice, backwards\)/);
  assert.match(component, /event\.preventDefault\(\)/);
});

test("focus follows the choice the arrows make", () => {
  // The re-render moves tabIndex 0 to the newly selected option, so focus has
  // to move with it or the next Tab leaves from the wrong place.
  assert.match(component, /data-theme-option=\{option\}/);
  assert.match(component, /querySelector<HTMLElement>\(`\[data-theme-option="\$\{next\}"\]`\)/);
});

test("the keys are handled on the options, not on the group", () => {
  // The container has a non-interactive role; a listener there is what
  // jsx-a11y/no-noninteractive-element-interactions rejects.
  assert.match(component, /onKeyDown=\{handleKeyDown\}/);
  const group = component.slice(component.indexOf('role="radiogroup"'), component.indexOf("THEME_CHOICES.map"));
  assert.ok(!group.includes("onKeyDown"), "the radiogroup container must not take key listeners");
});

test("all three choices are offered", () => {
  assert.match(component, /THEME_CHOICES\.map/);
  assert.equal(THEME_CHOICES.length, 3);
});

test("selection is not carried by colour alone", () => {
  // aria-checked for assistive tech, plus a raised face and a border.
  const selected = rule(".theme-option.selected");
  assert.match(selected, /background:/);
  assert.match(selected, /border-color:/);
});

test("the control reads the document rather than holding its own copy", () => {
  // The boot script sets data-theme before React exists, so React state would
  // start out disagreeing with the page it is describing.
  assert.match(component, /useSyncExternalStore/);
  assert.match(component, /getAttribute\("data-theme"\)/);
  assert.match(component, /getServerSnapshot/);
});

test("a change is broadcast, so a second switcher or tab keeps up", () => {
  assert.match(component, /THEME_CHANGE_EVENT/);
  assert.match(component, /addEventListener\("storage", onChange\)/);
});

test("the switcher is in the header", () => {
  assert.match(page, /<ThemeSwitcher \/>/);
  assert.ok(
    page.indexOf("<ThemeSwitcher />") < page.indexOf('className="tools-section"'),
    "it belongs in the header, above the tools",
  );
});

// ------------------------------------------------------------- the styles --

test("every option meets the touch minimum", () => {
  assert.match(rule(".theme-option"), /min-height:\s*var\(--size-touch-min\)/);
  // On a narrow screen the labels go and the squares have to hold their width.
  const narrow = css.slice(css.indexOf("@media (max-width: 620px)"));
  assert.match(narrow, /\.theme-option \{[^}]*min-width:\s*var\(--size-touch-min\)/);
});

test("the hidden labels are still read out", () => {
  // Clipped, not display:none — the accessible name has to survive.
  const narrow = css.slice(css.indexOf("@media (max-width: 620px)"));
  const label = narrow.match(/\.theme-option-label \{([^}]*)\}/);
  assert.ok(label, ".theme-option-label must be hidden rather than removed");
  assert.match(label[1], /clip-path:\s*inset\(50%\)/);
  assert.doesNotMatch(label[1], /display:\s*none/);
  assert.doesNotMatch(label[1], /visibility:\s*hidden/);
});

test("the switcher takes the one shared focus ring", () => {
  assert.match(css, /\.theme-option:focus-visible/);
  assert.doesNotMatch(rule(".theme-option"), /outline/);
});

test("the header can wrap rather than overflow", () => {
  assert.match(rule(".header-tools"), /flex-wrap:\s*wrap/);
});

// ------------------------------------------------------------- contrast ---

for (const [name, theme] of THEMES) {
  test(`${name}: the switcher's text clears AA`, () => {
    const track = token(theme, "surface-sunken");
    const face = token(theme, "surface-raised");

    const resting = contrast(token(theme, "text-secondary"), track);
    assert.ok(resting >= 4.5, `resting option ${resting.toFixed(2)}:1 on the track`);

    const selected = contrast(token(theme, "ink"), face);
    assert.ok(selected >= 4.5, `selected option ${selected.toFixed(2)}:1 on its face`);
  });

  test(`${name}: the selected face stands out from the track`, () => {
    // It is the main non-colour signal, so it must not blend in. A raised
    // white face was 1.06:1 against the light track — invisible.
    const ratio = contrast(token(theme, "blue"), token(theme, "surface-sunken"));
    assert.ok(ratio >= 3, `the selected face is ${ratio.toFixed(2)}:1 against the track`);
  });

  test(`${name}: the selected option's own text clears AA`, () => {
    const ratio = contrast(token(theme, "on-accent"), token(theme, "blue"));
    assert.ok(ratio >= 4.5, `${ratio.toFixed(2)}:1 — the label is 14px bold, so 4.5:1 applies`);
  });

  test(`${name}: the focus ring survives on the selected face`, () => {
    const ratio = contrast(token(theme, "focus-color"), token(theme, "blue"));
    assert.ok(ratio >= 3, `ring is ${ratio.toFixed(2)}:1 on the selected option`);
  });

  test(`${name}: the focus ring is visible on both the track and the face`, () => {
    for (const surface of ["surface-sunken", "surface-raised"]) {
      const ratio = contrast(token(theme, "focus-color"), token(theme, surface));
      assert.ok(ratio >= 3, `ring is ${ratio.toFixed(2)}:1 on --${surface}`);
    }
  });
}

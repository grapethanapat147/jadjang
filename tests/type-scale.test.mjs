import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

const THAI_MINIMUM_PX = 14;

/** Elements that carry a glyph as decoration rather than text to read. */
const NOT_TEXT = [".lock-symbol"];

function tokenTable(prefix) {
  const table = new Map();
  for (const [, name, value] of css.matchAll(
    new RegExp(`--(${prefix}-[a-z0-9-]+):\\s*(\\d+)px`, "g"),
  )) {
    if (name.endsWith("-leading")) continue;
    table.set(name, Number(value));
  }
  return table;
}

const typeTokens = tokenTable("type");
const spaceTokens = tokenTable("space");
const radiusTokens = tokenTable("radius");

/** Every font-size declaration, paired with the selector that owns it. */
function fontSizeDeclarations() {
  const found = [];
  for (const rule of css.matchAll(/([^{}\n]+)\{([^}]*)\}/g)) {
    const selector = rule[1].trim();
    const declaration = rule[2].match(/font-size:\s*([^;}]+)/);
    if (declaration) found.push({ selector, value: declaration[1].trim() });
  }
  return found;
}

/** Smallest size a declaration can render at, following tokens and clamp(). */
function smallestPx(value) {
  const tokens = [...value.matchAll(/var\(--(type-[a-z0-9-]+)\)/g)].map((m) => typeTokens.get(m[1]));
  if (tokens.length) return Math.min(...tokens.filter((n) => n !== undefined));
  const raw = value.match(/(\d+)px/);
  return raw ? Number(raw[1]) : null;
}

test("the scale replaced the pile of ad-hoc sizes", () => {
  // There were 24 distinct font sizes before this scale existed.
  assert.ok(typeTokens.size <= 8, `${typeTokens.size} type sizes, expected 8 or fewer`);
  assert.ok(spaceTokens.size <= 9, `${spaceTokens.size} spacing steps, expected 9 or fewer`);
  assert.ok(radiusTokens.size <= 6, `${radiusTokens.size} radii, expected 6 or fewer`);
});

test("no Thai the user reads drops below the minimum", () => {
  for (const { selector, value } of fontSizeDeclarations()) {
    if (NOT_TEXT.some((exempt) => selector.includes(exempt))) continue;
    const size = smallestPx(value);
    assert.ok(size !== null, `${selector} has an unreadable font-size: ${value}`);
    assert.ok(
      size >= THAI_MINIMUM_PX,
      `${selector} can render at ${size}px, under the ${THAI_MINIMUM_PX}px Thai minimum`,
    );
  }
});

test("font sizes come from the scale rather than stray values", () => {
  const strays = fontSizeDeclarations().filter(
    ({ selector, value }) =>
      !value.includes("var(--type-") && !NOT_TEXT.some((exempt) => selector.includes(exempt)),
  );
  assert.deepEqual(strays, [], "every font-size should read from a --type token");
});

test("gaps, padding and margins come from the spacing scale", () => {
  const strays = [];
  for (const rule of css.matchAll(/([^{}\n]+)\{([^}]*)\}/g)) {
    if (rule[1].includes(":root")) continue;
    for (const declaration of rule[2].matchAll(
      /\b((?:gap|row-gap|column-gap|padding|margin)(?:-[a-z]+)?):\s*([^;}]+)/g,
    )) {
      const value = declaration[2];
      // Negative offsets have no positive token to point at.
      if (/-\d/.test(value)) continue;
      if (/\d+px/.test(value) && !value.includes("var(--space-")) {
        strays.push(`${rule[1].trim().slice(0, 40)} { ${declaration[1]}: ${value.trim()} }`);
      }
    }
  }
  assert.deepEqual(strays, []);
});

test("corners come from the radius scale", () => {
  const strays = [];
  for (const rule of css.matchAll(/([^{}\n]+)\{([^}]*)\}/g)) {
    if (rule[1].includes(":root")) continue;
    for (const declaration of rule[2].matchAll(/border-radius:\s*([^;}]+)/g)) {
      if (/\d+px/.test(declaration[1]) && !declaration[1].includes("var(--radius-")) {
        strays.push(`${rule[1].trim().slice(0, 40)} { border-radius: ${declaration[1].trim()} }`);
      }
    }
  }
  assert.deepEqual(strays, []);
});

test("the touch minimum is a size, not a spacing step", () => {
  // Rounding it to the nearest spacing step would put it at 48px or 44 would
  // vanish into --space-3xl; it has to keep its own name.
  assert.match(css, /--size-touch-min:\s*44px/);
  assert.ok(!spaceTokens.has("space-touch-min"));
});

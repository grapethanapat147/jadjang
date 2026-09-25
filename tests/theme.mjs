import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

const linear = (channel) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function luminance(hex) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** The body of the first rule matching `selector`. */
export function block(selector) {
  const index = css.indexOf(selector);
  assert.notEqual(index, -1, `${selector} must exist`);
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function declarations(body) {
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

export const LIGHT = declarations(block(":root {"));
export const DARK = { ...LIGHT, ...declarations(block(':root[data-theme="dark"] {')) };

/**
 * A token's value in a theme, following var() indirection. Returns a hex
 * string, or the raw value when it is not a colour (rgba, a length).
 */
export function token(theme, name) {
  let value = theme[name];
  assert.ok(value !== undefined, `--${name} must be defined`);
  for (let hops = 0; hops < 5; hops += 1) {
    const indirect = value.match(/^var\(--([\w-]+)\)$/);
    if (!indirect) break;
    value = theme[indirect[1]];
    assert.ok(value !== undefined, `--${indirect[1]} must be defined`);
  }
  return value.toLowerCase();
}

export const THEMES = [
  ["light", LIGHT],
  ["dark", DARK],
];

/** Tool ids as the stylesheet names them. */
export const TOOLS = ["organize", "merge", "split", "compress", "convert"];

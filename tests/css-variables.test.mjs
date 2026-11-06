import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("every custom property the stylesheet reads is defined somewhere in it", () => {
  // An undefined var() is not an error in CSS: the declaration is dropped and
  // the value is inherited instead. That is how nine tool-coloured headings
  // quietly turned plain ink for a release without a single test failing.
  const used = new Set([...css.matchAll(/var\(\s*--([\w-]+)/g)].map((m) => m[1]));
  const defined = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !defined.has(name)).sort();
  assert.deepEqual(missing, [], `read but never defined: ${missing.map((n) => `--${n}`).join(", ")}`);
});

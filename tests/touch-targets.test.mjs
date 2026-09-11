import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const MINIMUM_TOUCH_TARGET_PX = 44;

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function block(query) {
  const start = css.indexOf(`@media ${query} {`);
  if (start < 0) return null;
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return { start, body: css.slice(start, index + 1) };
    }
  }
  return null;
}

test("sizes every page control for a finger on touch devices", () => {
  const coarse = block("(pointer: coarse)");
  assert.ok(coarse, "a (pointer: coarse) block must exist");

  for (const selector of [".page-controls button", ".page-card-top label", ".selection-summary button"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = coarse.body.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `${selector} must be sized for touch`);
    const minHeight = rule[1].match(/min-height:\s*(\d+)px/);
    assert.ok(minHeight, `${selector} needs an explicit min-height`);
    assert.ok(
      Number(minHeight[1]) >= MINIMUM_TOUCH_TARGET_PX,
      `${selector} is ${minHeight[1]}px, under the ${MINIMUM_TOUCH_TARGET_PX}px minimum`,
    );
  }
});

test("gives the page controls room to be wide enough as well as tall enough", () => {
  const coarse = block("(pointer: coarse)");
  // Four buttons across a narrow page card leave each about 30px wide, so the
  // touch layout drops to two columns.
  assert.match(coarse.body, /\.page-controls\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
});

test("keeps the touch sizes after the width queries that would shrink them", () => {
  // Media queries carry equal specificity, so the narrow-viewport block shrinking
  // .add-file-button / .clear-button would win if it came later.
  const narrow = block("(max-width: 620px)");
  const coarse = block("(pointer: coarse)");
  assert.match(narrow.body, /\.add-file-button,\s*\.clear-button\s*\{[^}]*min-height:\s*39px/);
  assert.match(coarse.body, /\.add-file-button,\s*\.clear-button\s*\{[^}]*min-height:\s*44px/);
  assert.ok(coarse.start > narrow.start, "the touch block must come after the narrow-viewport block");
});

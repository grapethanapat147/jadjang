import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  GAME_MODE_STORAGE_KEY,
  SHOT_TOTAL_MS,
  ballLabel,
  readGameMode,
  shotKeyframes,
  writeGameMode,
} from "../app/lib/game-mode.ts";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const hoop = await readFile(new URL("../app/Hoop.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

// ------------------------------------------------------------- the choice --

test("game mode is off until chosen, and off leaves nothing stored", () => {
  const storage = memoryStorage();
  assert.equal(readGameMode(storage), false);
  writeGameMode(storage, true);
  assert.equal(storage.map.get(GAME_MODE_STORAGE_KEY), "1");
  assert.equal(readGameMode(storage), true);
  writeGameMode(storage, false);
  assert.equal(storage.map.size, 0);
});

test("blocked storage means off, never a crash", () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(readGameMode(throwing), false);
  assert.doesNotThrow(() => writeGameMode(throwing, true));
  assert.equal(readGameMode(null), false);
});

test("the ball is labelled by file type", () => {
  assert.equal(ballLabel("สแกน.PNG"), "PNG");
  assert.equal(ballLabel("ใบเสร็จ.jpeg"), "JPG");
  assert.equal(ballLabel("รายงาน.pdf"), "PDF");
});

// ---------------------------------------------------------------- the shot --

test("every shot ends in the net: the last frame sits under the rim and fades out", () => {
  const rim = { x: 300, y: 100 };
  for (const start of [{ x: 20, y: 400 }, { x: 600, y: 380 }, { x: 300, y: 90 }]) {
    const frames = shotKeyframes(start, rim, 52, { w: 22, h: 28 });
    const last = frames.at(-1);
    const [, x, y] = last.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).map(Number);
    assert.ok(Math.abs(x + 22 - rim.x) < 0.1, "the ball ends centred on the rim");
    assert.ok(y + 28 > rim.y, "the ball ends below the rim");
    assert.ok(last.opacity < 1e-9, "and has faded out");
    assert.equal(last.offset, 1);
  }
});

test("keyframe offsets only move forward, from 0 to 1", () => {
  const frames = shotKeyframes({ x: 0, y: 300 }, { x: 200, y: 50 }, 40, { w: 22, h: 28 });
  assert.equal(frames[0].offset, 0);
  for (let i = 1; i < frames.length; i += 1) assert.ok(frames[i].offset >= frames[i - 1].offset);
});

test("one shot stays about a second, as tuned in the prototype", () => {
  assert.ok(SHOT_TOTAL_MS > 800 && SHOT_TOTAL_MS < 1300, `${SHOT_TOTAL_MS}ms`);
});

// ---------------------------------------------------------------- the page --

test("the files are read straight away; the shot is never awaited", () => {
  assert.match(page, /void addFiles\(files\);\n\s+if \(gameMode\)/);
  assert.doesNotMatch(page, /await throwIntoHoop/);
});

test("people who ask for less motion get no shot", () => {
  assert.match(hoop, /prefers-reduced-motion: reduce\)"\)\.matches\) return;/);
});

test("the shot is hidden from screen readers and cannot catch clicks", () => {
  assert.match(hoop, /aria-hidden="true"/);
  assert.match(hoop, /layer\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(css, /\.hoop-shot \{[^}]*pointer-events: none/);
});

test("the switch is a real checkbox, big enough to tap, with a focus ring", () => {
  assert.match(page, /<input type="checkbox" role="switch" checked=\{gameMode\}/);
  assert.match(css, /\.game-toggle \{[^}]*min-height: var\(--size-touch-min\)/);
  assert.match(css, /\.game-toggle input:focus-visible/);
});

test("the file name never reaches the page as markup", () => {
  // Only the fixed PDF/JPG/PNG label is written, and as text.
  assert.match(hoop, /textContent = ballLabel\(name\)/);
  assert.doesNotMatch(hoop, /innerHTML = [^B]/);
});

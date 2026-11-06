import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  GAME_MODE_STORAGE_KEY,
  arc,
  ballLabel,
  depthScale,
  planShot,
  readGameMode,
  shotKind,
  writeGameMode,
} from "../app/lib/game-mode.ts";

const page = await readFile(new URL("../app/Workspace.tsx", import.meta.url), "utf8");
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

const HOOP = { rim: { x: 300, y: 200 }, halfWidth: 36, netDepth: 40, boardY: 150 };
const position = (frame) => {
  const [, x, y] = frame.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).map(Number);
  return { x: x + 22, y: y + 28 };
};

test("a throw follows real projectile motion: it ends on target and rises above both ends", () => {
  const from = { x: 0, y: 500 };
  const to = { x: 300, y: 200 };
  const path = arc(from, to, 120);
  assert.deepEqual(path(0), from);
  assert.ok(Math.abs(path(1).x - to.x) < 1e-9 && Math.abs(path(1).y - to.y) < 1e-6);
  const peak = Math.min(...Array.from({ length: 101 }, (_, i) => path(i / 100).y));
  assert.ok(Math.abs(peak - (200 - 120)) < 1, `peaks ${peak}`);
  // Constant gravity: equal time steps change the vertical speed by equal amounts.
  const v = (t) => path(t + 0.01).y - path(t).y;
  assert.ok(Math.abs((v(0.2) - v(0.1)) - (v(0.8) - v(0.7))) < 1e-6);
});

test("the ball shrinks as it travels away, as perspective does", () => {
  assert.equal(depthScale(0, 1.4, 0.7), 1.4);
  assert.ok(Math.abs(depthScale(1, 1.4, 0.7) - 0.7) < 1e-9);
  // Far things shrink more slowly than a straight blend would suggest.
  assert.ok(depthScale(0.5, 1.4, 0.7) < (1.4 + 0.7) / 2);
});

for (const kind of ["swish", "rim", "board"]) {
  test(`a ${kind} shot always ends in the net, faded out`, () => {
    for (const start of [{ x: 40, y: 600 }, { x: 560, y: 560 }, { x: 300, y: 420 }]) {
      const plan = planShot(start, HOOP, kind);
      const last = plan.ball.at(-1);
      const end = position(last);
      assert.ok(Math.abs(end.x - HOOP.rim.x) < 0.2, "centred on the rim");
      assert.ok(end.y > HOOP.rim.y, "below the rim");
      assert.equal(last.opacity, 0);
      assert.equal(last.offset, 1);
      assert.equal(plan.ball[0].offset, 0);
      for (let i = 1; i < plan.ball.length; i += 1) assert.ok(plan.ball[i].offset >= plan.ball[i - 1].offset);
      assert.equal(plan.shadow.length, plan.ball.length, "the shadow moves with the ball");
    }
  });
}

test("rim and bank shots touch first, then drop; a swish touches nothing", () => {
  const start = { x: 40, y: 600 };
  assert.equal(planShot(start, HOOP, "swish").contact, null);
  for (const kind of ["rim", "board"]) {
    const plan = planShot(start, HOOP, kind);
    assert.equal(plan.contact.kind, kind);
    assert.ok(plan.contact.at < plan.netAt && plan.netAt < plan.duration);
  }
});

test("a shot lasts about a second and a half at most", () => {
  for (const kind of ["swish", "rim", "board"]) {
    const { duration } = planShot({ x: 0, y: 900 }, HOOP, kind);
    assert.ok(duration > 900 && duration <= 1600, `${kind}: ${duration}ms`);
  }
});

test("a batch mixes the ways a shot goes in", () => {
  assert.deepEqual([0, 1, 2, 3].map(shotKind), ["rim", "swish", "board", "rim"]);
});

// ---------------------------------------------------------------- the page --

test("files are read while the ball flies; only the reveal waits for it to go in", () => {
  const addFiles = page.slice(page.indexOf("async function addFiles"), page.indexOf("function handleInput"));
  const reveal = addFiles.indexOf("const reveal = onAccepted?.()");
  // The shot starts after validation, before any file is read...
  assert.ok(reveal > addFiles.indexOf("validateInputFiles(candidates)"));
  assert.ok(reveal < addFiles.indexOf("await file.arrayBuffer()"));
  // ...and is awaited only after reading, just before the workspace is shown.
  const held = addFiles.indexOf("if (reveal) await reveal;");
  assert.ok(held > addFiles.indexOf("await file.arrayBuffer()"));
  assert.ok(held < addFiles.indexOf("setPages(combinedPages)"));
  assert.doesNotMatch(page, /await throwIntoHoop/);
});

test("the hoop layer hands over to the workspace instead of lingering over it", () => {
  assert.match(hoop, /const handOver = lastNet \+ \d+;/);
  assert.match(hoop, /delay: handOver/);
  assert.match(hoop, /setTimeout\(resolve, handOver\)/);
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

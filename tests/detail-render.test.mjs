import assert from "node:assert/strict";
import test from "node:test";
import { createDetailRenderQueue, detailRenderSize, sameRenderBox } from "../app/lib/detail-render.ts";
import { nextTrapTarget } from "../app/lib/focus-trap.ts";

const A4 = { pageWidth: 595, pageHeight: 842 };

// ------------------------------------------------------------- sizing --

test("renders at the displayed width times the pixel ratio", () => {
  const size = detailRenderSize({ cssWidth: 700, ...A4, devicePixelRatio: 2 });
  assert.equal(size.width, 1400);
});

test("caps the pixel ratio at 2", () => {
  const two = detailRenderSize({ cssWidth: 700, ...A4, devicePixelRatio: 2 });
  const three = detailRenderSize({ cssWidth: 700, ...A4, devicePixelRatio: 3 });
  assert.deepEqual(three, two);
});

test("treats a ratio under 1 as 1", () => {
  const size = detailRenderSize({ cssWidth: 700, ...A4, devicePixelRatio: 0.75 });
  assert.equal(size.width, 700);
});

test("defaults to a ratio of 1", () => {
  assert.equal(detailRenderSize({ cssWidth: 512, ...A4 }).width, 512);
});

test("keeps the page's aspect ratio", () => {
  const size = detailRenderSize({ cssWidth: 600, ...A4, devicePixelRatio: 1 });
  assert.equal(size.height, Math.round(600 * (842 / 595)));
});

test("keeps the aspect ratio of a landscape page too", () => {
  const size = detailRenderSize({
    cssWidth: 800,
    pageWidth: 842,
    pageHeight: 595,
    devicePixelRatio: 1,
  });
  assert.equal(size.height, Math.round(800 * (595 / 842)));
  assert.ok(size.width > size.height, "a landscape page must stay wider than it is tall");
});

test("the scale it reports reproduces the width it asked for", () => {
  const size = detailRenderSize({ cssWidth: 640, ...A4, devicePixelRatio: 2 });
  assert.equal(Math.round(595 * size.scale), size.width);
});

test("a portrait page in a landscape box is sized by the height it fits", () => {
  // 1104x787 with an A4 page: contain limits it to 787 tall and 556 wide, so
  // rendering the full 1104 would be four times the pixels the screen shows.
  const fitted = detailRenderSize({ cssWidth: 1104, cssHeight: 787, ...A4, devicePixelRatio: 2 });
  const displayWidth = 787 / (842 / 595);
  assert.equal(fitted.width, Math.round(displayWidth * 2));
  assert.ok(fitted.height <= 787 * 2 + 1, `height ${fitted.height} exceeds the box`);

  const unfitted = detailRenderSize({ cssWidth: 1104, ...A4, devicePixelRatio: 2 });
  assert.ok(
    fitted.width * fitted.height < unfitted.width * unfitted.height / 3,
    "fitting to the box must cut the pixel count several-fold",
  );
});

test("a box taller than the page is limited by the width instead", () => {
  const size = detailRenderSize({ cssWidth: 600, cssHeight: 4000, ...A4, devicePixelRatio: 1 });
  assert.equal(size.width, 600, "a box with height to spare must use the full width");
});

test("a height of zero is ignored rather than collapsing the render", () => {
  const size = detailRenderSize({ cssWidth: 600, cssHeight: 0, ...A4, devicePixelRatio: 1 });
  assert.equal(size.width, 600);
});

test("a laptop-sized box is rendered at full device pixels, not clamped", () => {
  // The clamp is a canvas limit, so it must not bind at ordinary sizes: a
  // render below the displayed device pixels is the upscaling the spec forbids.
  const size = detailRenderSize({ cssWidth: 1104, ...A4, devicePixelRatio: 2 });
  assert.equal(size.width, 2208);
});

test("clamps a canvas that no browser would allocate, holding the ratio", () => {
  const size = detailRenderSize({ cssWidth: 3400, ...A4, devicePixelRatio: 2 });
  assert.ok(size.width <= 4096, `width ${size.width} exceeds the edge limit`);
  assert.ok(size.height <= 4096, `height ${size.height} exceeds the edge limit`);
  assert.ok(size.width * size.height <= 16_000_000, `${size.width}x${size.height} exceeds the pixel limit`);

  const asked = 842 / 595;
  const got = size.height / size.width;
  assert.ok(Math.abs(got - asked) < 0.01, `aspect drifted to ${got.toFixed(3)} from ${asked.toFixed(3)}`);
});

test("a square page is clamped by area, not just by edge", () => {
  // 4096x4096 clears the edge limit and still exceeds what iOS will allocate.
  const size = detailRenderSize({
    cssWidth: 3400,
    pageWidth: 600,
    pageHeight: 600,
    devicePixelRatio: 2,
  });
  assert.ok(size.width * size.height <= 16_000_000, `${size.width}x${size.height} exceeds the pixel limit`);
  assert.equal(size.width, size.height, "a square page must stay square");
});

test("always beats the 0.32-scale thumbnail it replaces", () => {
  // The whole point of the second render: at ratio 1 on a narrow phone it must
  // still resolve more than the card already showed.
  const thumbnail = 595 * 0.32;
  const size = detailRenderSize({ cssWidth: 328, ...A4, devicePixelRatio: 1 });
  assert.ok(size.width > thumbnail, `${size.width}px is no sharper than the ${thumbnail}px thumbnail`);
});

test("refuses a zero or negative box", () => {
  for (const bad of [
    { cssWidth: 0, ...A4 },
    { cssWidth: -10, ...A4 },
    { cssWidth: 100, pageWidth: 0, pageHeight: 842 },
    { cssWidth: 100, pageWidth: 595, pageHeight: 0 },
  ]) {
    assert.throws(() => detailRenderSize(bad));
  }
});

// -------------------------------------------------------------- queue --

test("returns the render for the only request", async () => {
  const queue = createDetailRenderQueue();
  assert.equal(await queue.request("a", async () => "A"), "A");
});

test("drops a render that a later request overtook", async () => {
  const queue = createDetailRenderQueue();
  let releaseFirst;
  const first = queue.request("a", () => new Promise((resolve) => { releaseFirst = resolve; }));
  const second = await queue.request("b", async () => "B");

  releaseFirst("A");
  assert.equal(await first, null, "the overtaken render must not be displayed");
  assert.equal(second, "B");
});

test("a superseded render is still cached for the page it belongs to", async () => {
  const queue = createDetailRenderQueue();
  let releaseFirst;
  let renders = 0;
  const render = () => { renders += 1; return new Promise((resolve) => { releaseFirst = resolve; }); };

  const first = queue.request("a", render);
  await queue.request("b", async () => "B");
  releaseFirst("A");
  await first;

  assert.equal(await queue.request("a", render), "A", "paging back must not re-render");
  assert.equal(renders, 1);
});

test("a cached key is not rendered twice", async () => {
  const queue = createDetailRenderQueue();
  let renders = 0;
  const render = async () => { renders += 1; return "A"; };

  await queue.request("a", render);
  await queue.request("a", render);
  assert.equal(renders, 1);
});

test("a cache hit still counts as the latest request", async () => {
  const queue = createDetailRenderQueue();
  await queue.request("a", async () => "A");

  let releaseSlow;
  const slow = queue.request("b", () => new Promise((resolve) => { releaseSlow = resolve; }));
  const cached = await queue.request("a", async () => "A");

  releaseSlow("B");
  assert.equal(cached, "A");
  assert.equal(await slow, null, "the slow render lost to the cache hit and must be dropped");
});

test("clearing drops the cache and hands every value back", async () => {
  const queue = createDetailRenderQueue();
  await queue.request("a", async () => "A");
  await queue.request("b", async () => "B");

  const dropped = [];
  queue.clear((value) => dropped.push(value));
  assert.deepEqual(dropped.sort(), ["A", "B"]);

  let renders = 0;
  await queue.request("a", async () => { renders += 1; return "A"; });
  assert.equal(renders, 1, "a cleared key must be rendered again");
});

test("a render in flight when the queue is cleared is dropped", async () => {
  const queue = createDetailRenderQueue();
  let release;
  const pending = queue.request("a", () => new Promise((resolve) => { release = resolve; }));

  queue.clear();
  release("A");
  assert.equal(await pending, null);
});

test("a failed render rejects rather than caching a failure", async () => {
  const queue = createDetailRenderQueue();
  await assert.rejects(() => queue.request("a", async () => { throw new Error("no canvas"); }));

  assert.equal(await queue.request("a", async () => "A"), "A", "a failure must be retryable");
});

// --------------------------------------------------------- focus trap --

test("Tab moves forward and wraps at the end", () => {
  const controls = ["close", "previous", "next"];
  assert.equal(nextTrapTarget(controls, "close", false), "previous");
  assert.equal(nextTrapTarget(controls, "previous", false), "next");
  assert.equal(nextTrapTarget(controls, "next", false), "close");
});

test("Shift+Tab moves backward and wraps at the start", () => {
  const controls = ["close", "previous", "next"];
  assert.equal(nextTrapTarget(controls, "next", true), "previous");
  assert.equal(nextTrapTarget(controls, "close", true), "next");
});

test("focus outside the trap is pulled to the near end", () => {
  const controls = ["close", "previous", "next"];
  assert.equal(nextTrapTarget(controls, "thumbnail", false), "close");
  assert.equal(nextTrapTarget(controls, "thumbnail", true), "next");
  assert.equal(nextTrapTarget(controls, null, false), "close");
});

test("an empty trap has nowhere to send focus", () => {
  assert.equal(nextTrapTarget([], "close", false), null);
  assert.equal(nextTrapTarget([], null, true), null);
});

test("a single control keeps focus on itself", () => {
  assert.equal(nextTrapTarget(["close"], "close", false), "close");
  assert.equal(nextTrapTarget(["close"], "close", true), "close");
});

// --------------------------------------------------- re-measuring the box --

test("the first measurement always counts", () => {
  assert.equal(sameRenderBox(null, { width: 800, height: 600 }), false);
});

test("a zero box is never mistaken for a real one", () => {
  // The frame measures zero in a tab that has not been laid out; keeping that
  // reading is what would leave the overlay on the blurry thumbnail for good.
  assert.equal(sameRenderBox({ width: 0, height: 0 }, { width: 1104, height: 787 }), false);
  assert.equal(sameRenderBox({ width: 1104, height: 787 }, { width: 0, height: 0 }), false);
  assert.equal(sameRenderBox({ width: 1104, height: 0 }, { width: 1104, height: 787 }), false);
});

test("two zero readings in a row do not churn", () => {
  assert.equal(sameRenderBox({ width: 0, height: 0 }, { width: 0, height: 0 }), true);
});

test("a few pixels of drag do not trigger a re-render", () => {
  assert.equal(sameRenderBox({ width: 1104, height: 787 }, { width: 1110, height: 790 }), true);
});

test("a real resize does trigger one", () => {
  assert.equal(sameRenderBox({ width: 1104, height: 787 }, { width: 1400, height: 787 }), false);
  assert.equal(sameRenderBox({ width: 1104, height: 787 }, { width: 1104, height: 500 }), false);
});

test("the tolerance sits either side of the boundary", () => {
  const base = { width: 1000, height: 1000 };
  assert.equal(sameRenderBox(base, { width: 1079, height: 1000 }), true, "7.9% must be tolerated");
  assert.equal(sameRenderBox(base, { width: 1081, height: 1000 }), false, "8.1% must re-render");
});

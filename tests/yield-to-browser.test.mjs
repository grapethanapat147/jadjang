import assert from "node:assert/strict";
import test from "node:test";
import { YIELD_FALLBACK_MS, yieldToBrowser } from "../app/lib/yield-to-browser.ts";

test("resolves when requestAnimationFrame is unavailable", async () => {
  assert.equal(typeof globalThis.requestAnimationFrame, "undefined");
  await yieldToBrowser(0);
});

test("resolves even when requestAnimationFrame never fires", async () => {
  // Exactly what a hidden tab does: the callback is registered and then dropped.
  const dropped = [];
  globalThis.requestAnimationFrame = (callback) => {
    dropped.push(callback);
    return dropped.length;
  };
  try {
    await yieldToBrowser(5);
    assert.equal(dropped.length, 1, "the frame callback was registered");
  } finally {
    delete globalThis.requestAnimationFrame;
  }
});

test("resolves on the frame callback without waiting out the fallback", async () => {
  globalThis.requestAnimationFrame = (callback) => {
    queueMicrotask(() => callback(0));
    return 1;
  };
  try {
    const started = process.hrtime.bigint();
    await yieldToBrowser(YIELD_FALLBACK_MS);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < YIELD_FALLBACK_MS, `resolved in ${elapsedMs.toFixed(1)}ms`);
  } finally {
    delete globalThis.requestAnimationFrame;
  }
});

test("resolves only once when both paths fire", async () => {
  let resolutions = 0;
  globalThis.requestAnimationFrame = (callback) => {
    setTimeout(() => callback(0), 0);
    return 1;
  };
  try {
    await yieldToBrowser(0).then(() => {
      resolutions += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(resolutions, 1);
  } finally {
    delete globalThis.requestAnimationFrame;
  }
});

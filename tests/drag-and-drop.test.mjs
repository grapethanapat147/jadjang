import assert from "node:assert/strict";
import test from "node:test";
import { isLeavingDropTarget } from "../app/lib/drag-and-drop.ts";

const child = { name: "child" };
const outside = { name: "outside" };
const container = { contains: (node) => node === child };

test("keeps the highlight while the pointer moves onto a child", () => {
  // The flicker this prevents: dragleave fires on the container every time the
  // pointer crosses onto one of its own children.
  assert.equal(isLeavingDropTarget(container, child), false);
});

test("drops the highlight when the pointer moves outside", () => {
  assert.equal(isLeavingDropTarget(container, outside), true);
});

test("drops the highlight when the pointer leaves the window", () => {
  assert.equal(isLeavingDropTarget(container, null), true);
});

test("drops the highlight when there is no container to be inside of", () => {
  assert.equal(isLeavingDropTarget(null, child), true);
});

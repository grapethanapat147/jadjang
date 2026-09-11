import assert from "node:assert/strict";
import test from "node:test";
import { nextToolIndex } from "../app/lib/tool-navigation.ts";

const TOTAL = 5;

test("moves forward with either forward arrow", () => {
  assert.equal(nextToolIndex("ArrowRight", 0, TOTAL), 1);
  assert.equal(nextToolIndex("ArrowDown", 0, TOTAL), 1);
});

test("moves backward with either backward arrow", () => {
  assert.equal(nextToolIndex("ArrowLeft", 3, TOTAL), 2);
  assert.equal(nextToolIndex("ArrowUp", 3, TOTAL), 2);
});

test("wraps around both ends so one key reaches every tool", () => {
  assert.equal(nextToolIndex("ArrowRight", TOTAL - 1, TOTAL), 0);
  assert.equal(nextToolIndex("ArrowLeft", 0, TOTAL), TOTAL - 1);
});

test("jumps to the first and last tool", () => {
  assert.equal(nextToolIndex("Home", 3, TOTAL), 0);
  assert.equal(nextToolIndex("End", 1, TOTAL), TOTAL - 1);
});

test("ignores keys the tablist does not own", () => {
  for (const key of ["Enter", " ", "Tab", "Escape", "a", "PageDown"]) {
    assert.equal(nextToolIndex(key, 2, TOTAL), null, `${key} must fall through`);
  }
});

test("stays in range when the current tool is unknown or the list is empty", () => {
  assert.equal(nextToolIndex("ArrowRight", -1, TOTAL), 1);
  assert.equal(nextToolIndex("ArrowLeft", -1, TOTAL), TOTAL - 1);
  assert.equal(nextToolIndex("ArrowRight", 0, 0), null);
});

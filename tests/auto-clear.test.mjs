import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_CLEAR_DELAY_MS, createAutoClearTimer } from "../app/lib/auto-clear.ts";

function countingTimer() {
  const state = { runs: 0, timer: createAutoClearTimer() };
  state.run = () => {
    state.runs += 1;
  };
  return state;
}

test("clears the workspace once the delay elapses", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = countingTimer();

  state.timer.schedule(state.run);
  assert.equal(state.timer.isPending(), true);

  t.mock.timers.tick(AUTO_CLEAR_DELAY_MS - 1);
  assert.equal(state.runs, 0, "must not fire before the delay");

  t.mock.timers.tick(1);
  assert.equal(state.runs, 1);
  assert.equal(state.timer.isPending(), false);
});

test("cancel keeps a pending clear from wiping newly added files", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = countingTimer();

  state.timer.schedule(state.run);
  state.timer.cancel();
  assert.equal(state.timer.isPending(), false);

  t.mock.timers.tick(AUTO_CLEAR_DELAY_MS * 2);
  assert.equal(state.runs, 0, "a cancelled clear must never run");
});

test("a second download click restarts the timer instead of stacking one", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = countingTimer();

  state.timer.schedule(state.run);
  t.mock.timers.tick(AUTO_CLEAR_DELAY_MS / 2);
  state.timer.schedule(state.run);

  t.mock.timers.tick(AUTO_CLEAR_DELAY_MS / 2);
  assert.equal(state.runs, 0, "the restarted timer must not inherit the first one's progress");

  t.mock.timers.tick(AUTO_CLEAR_DELAY_MS / 2);
  assert.equal(state.runs, 1, "and it must run exactly once, not twice");

  t.mock.timers.tick(AUTO_CLEAR_DELAY_MS * 2);
  assert.equal(state.runs, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  EAGER_PREVIEW_LIMIT,
  canRetryPreview,
  previewState,
  unavailableReason,
} from "../app/lib/preview-state.ts";

test("a rendered thumbnail is ready", () => {
  assert.equal(previewState({ previewUrl: "data:image/jpeg;base64,x" }), "ready");
});

test("nothing yet means it is still being made", () => {
  assert.equal(previewState({}), "loading");
});

test("a failed render is an error", () => {
  assert.equal(previewState({ previewFailed: true }), "error");
});

test("a page past the limit is unavailable, not failed", () => {
  assert.equal(previewState({ previewSkipped: true }), "unavailable");
});

test("a successful retry leaves the error state behind", () => {
  // The flag is not cleared on the way in, so the image has to win.
  assert.equal(previewState({ previewUrl: "data:image/jpeg;base64,x", previewFailed: true }), "ready");
  assert.equal(previewState({ previewUrl: "data:image/jpeg;base64,x", previewSkipped: true }), "ready");
});

test("a failure on a skipped page still reads as a failure", () => {
  assert.equal(previewState({ previewFailed: true, previewSkipped: true }), "error");
});

test("only a failure offers a retry", () => {
  assert.equal(canRetryPreview({ previewFailed: true }), true);
  assert.equal(canRetryPreview({ previewSkipped: true }), false, "a limit is not a fault to retry");
  assert.equal(canRetryPreview({}), false, "a render in flight must not be restartable");
  assert.equal(canRetryPreview({ previewUrl: "x" }), false);
});

test("the limit copy is generated from the limit, never typed out", () => {
  assert.equal(unavailableReason(), `ระบบสร้างรูปย่ออัตโนมัติถึงหน้า ${EAGER_PREVIEW_LIMIT}`);
  assert.equal(unavailableReason(12), "ระบบสร้างรูปย่ออัตโนมัติถึงหน้า 12");
});

test("changing the limit changes the copy with it", () => {
  // The spec's rule: the number must never be written into the UI by hand.
  assert.ok(unavailableReason(99).includes("99"));
  assert.ok(!unavailableReason(99).includes(String(EAGER_PREVIEW_LIMIT)));
});

import assert from "node:assert/strict";
import test from "node:test";
import { installHint, isIosBrowser } from "../app/lib/install-hint.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const LINE_ON_IPHONE = `${IPHONE} Line/14.3.0`;
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36";

const base = { standalone: false, canPrompt: false, iosBrowser: false, dismissed: false };

test("an installable browser gets the install button", () => {
  assert.equal(installHint({ ...base, canPrompt: true }), "prompt");
});

test("iOS gets the Share-sheet instructions, since it has no prompt", () => {
  assert.equal(installHint({ ...base, iosBrowser: true }), "ios");
});

test("nothing is shown once installed or dismissed", () => {
  assert.equal(installHint({ ...base, canPrompt: true, standalone: true }), "none");
  assert.equal(installHint({ ...base, canPrompt: true, dismissed: true }), "none");
  assert.equal(installHint({ ...base, iosBrowser: true, dismissed: true }), "none");
});

test("a browser that can do neither shows nothing", () => {
  assert.equal(installHint(base), "none");
});

test("iPhone and iPad (which claims to be a Mac) are recognised", () => {
  assert.equal(isIosBrowser(IPHONE), true);
  assert.equal(isIosBrowser(IPAD_AS_MAC, 5), true);
  assert.equal(isIosBrowser(IPAD_AS_MAC, 0), false, "a real Mac has no touch points");
});

test("in-app browsers are excluded, because they cannot add to the home screen", () => {
  assert.equal(isIosBrowser(LINE_ON_IPHONE), false);
  assert.equal(isIosBrowser(`${IPHONE} [FBAN/FBIOS;FBAV/450.0]`), false);
});

test("Android is left to the real install prompt", () => {
  assert.equal(isIosBrowser(ANDROID_CHROME, 5), false);
});

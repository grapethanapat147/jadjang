import assert from "node:assert/strict";
import test from "node:test";
import { VISIT_FLAG_KEY, reportUsage, reportVisitOnce, usageAllowed } from "../app/lib/report-usage.ts";
import { USAGE_ENDPOINT, parseUsageEvent } from "../app/lib/usage.ts";

const RUN = { kind: "run", tool: "split", outcome: "success", pages: "1" };

function beaconNavigator(overrides = {}) {
  const sent = [];
  return {
    sent,
    navigator: {
      userAgent: "Mozilla/5.0 Safari/605.1.15",
      sendBeacon: (url, data) => { sent.push({ url, data }); return true; },
      ...overrides,
    },
  };
}

function memoryStorage({ throwing = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => { if (throwing) throw new Error("blocked"); return map.get(k) ?? null; },
    setItem: (k, v) => { if (throwing) throw new Error("blocked"); map.set(k, v); },
  };
}

// --------------------------------------------------------------- opt-out --

test("Global Privacy Control and Do Not Track switch counting off", () => {
  assert.equal(usageAllowed({ globalPrivacyControl: true }), false);
  assert.equal(usageAllowed({ doNotTrack: "1" }), false);
  assert.equal(usageAllowed({ doNotTrack: "yes" }), false);
  assert.equal(usageAllowed({ doNotTrack: "0" }), true);
  assert.equal(usageAllowed({}), true);
  assert.equal(usageAllowed(undefined), false, "no browser, no counting");
});

test("an opted-out visitor sends nothing at all", () => {
  const { navigator, sent } = beaconNavigator({ globalPrivacyControl: true });
  assert.equal(reportUsage(RUN, { navigator }), false);
  assert.equal(sent.length, 0);
});

// --------------------------------------------------------------- sending --

test("an event goes to the endpoint as a beacon", async () => {
  const { navigator, sent } = beaconNavigator();
  assert.equal(reportUsage(RUN, { navigator }), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, USAGE_ENDPOINT);
});

test("the beacon is text/plain, which sendBeacon never refuses", async () => {
  const { navigator, sent } = beaconNavigator();
  reportUsage(RUN, { navigator });
  assert.match(sent[0].data.type, /^text\/plain/);
});

test("what is sent is exactly the event, and the server accepts it", async () => {
  const { navigator, sent } = beaconNavigator();
  reportUsage(RUN, { navigator });
  const body = JSON.parse(await sent[0].data.text());
  assert.deepEqual(body, RUN);
  assert.deepEqual(parseUsageEvent(body), RUN);
});

test("without sendBeacon it falls back to a keepalive fetch", () => {
  const calls = [];
  const fetch = (url, init) => { calls.push({ url, init }); return Promise.resolve(); };
  assert.equal(reportUsage(RUN, { navigator: { userAgent: "x" }, fetch }), true);
  assert.equal(calls[0].url, USAGE_ENDPOINT);
  assert.equal(calls[0].init.keepalive, true);
  assert.equal(calls[0].init.method, "POST");
});

test("a refused beacon falls back to fetch", () => {
  const calls = [];
  const navigator = { userAgent: "x", sendBeacon: () => false };
  reportUsage(RUN, { navigator, fetch: (url) => { calls.push(url); return Promise.resolve(); } });
  assert.equal(calls.length, 1);
});

test("a network failure never surfaces", async () => {
  const fetch = () => Promise.reject(new Error("offline"));
  assert.doesNotThrow(() => reportUsage(RUN, { navigator: { userAgent: "x" }, fetch }));
  await new Promise((r) => setTimeout(r, 10));
});

test("a throwing sendBeacon never surfaces", () => {
  const navigator = { userAgent: "x", sendBeacon: () => { throw new Error("boom"); } };
  assert.doesNotThrow(() => reportUsage(RUN, { navigator }));
});

// ---------------------------------------------------------------- visits --

test("a visit is counted once per tab session", () => {
  const { navigator, sent } = beaconNavigator();
  const storage = memoryStorage();
  const context = { referrer: "https://www.google.co.th/", host: "jadjang.example", storage };
  assert.equal(reportVisitOnce(context, { navigator }), true);
  assert.equal(reportVisitOnce(context, { navigator }), false, "a reload is not a second visitor");
  assert.equal(sent.length, 1);
  assert.equal(storage.map.get(VISIT_FLAG_KEY), "1");
});

test("the visit carries only its source bucket", async () => {
  const { navigator, sent } = beaconNavigator();
  reportVisitOnce({ referrer: "https://www.google.co.th/search?q=รวม+pdf", host: "jadjang.example", storage: memoryStorage() }, { navigator });
  const body = JSON.parse(await sent[0].data.text());
  assert.deepEqual(body, { kind: "visit", source: "search" }, "the search query must not leave the device");
});

test("blocked storage still counts the visit and does not throw", () => {
  const { navigator, sent } = beaconNavigator();
  assert.doesNotThrow(() =>
    reportVisitOnce({ referrer: "", host: "x", storage: memoryStorage({ throwing: true }) }, { navigator }));
  assert.equal(sent.length, 1);
});

test("an opted-out visitor's visit is neither sent nor flagged", () => {
  const { navigator, sent } = beaconNavigator({ doNotTrack: "1" });
  const storage = memoryStorage();
  assert.equal(reportVisitOnce({ referrer: "", host: "x", storage }, { navigator }), false);
  assert.equal(sent.length, 0);
  assert.equal(storage.map.size, 0);
});

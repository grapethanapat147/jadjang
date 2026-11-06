import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGE_BUCKETS,
  SOURCE_BUCKETS,
  USAGE_OUTCOMES,
  USAGE_TOOLS,
  pageBucket,
  parseUsageEvent,
  sourceBucket,
  usageDay,
  usageRow,
} from "../app/lib/usage.ts";

// ----------------------------------------------------------- page buckets --

test("page counts fall into coarse buckets, never the exact number", () => {
  const cases = [[0, "1"], [1, "1"], [2, "2-5"], [5, "2-5"], [6, "6-20"], [20, "6-20"],
    [21, "21-100"], [100, "21-100"], [101, "101+"], [250, "101+"]];
  for (const [count, bucket] of cases) {
    assert.equal(pageBucket(count), bucket, `${count} pages`);
  }
});

test("every bucket the function can return is in the published vocabulary", () => {
  for (let count = 0; count <= 300; count += 1) {
    assert.ok(PAGE_BUCKETS.includes(pageBucket(count)), `${count} -> ${pageBucket(count)}`);
  }
});

// --------------------------------------------------------- source buckets --

const HOST = "jadjang.grapethanapat147.workers.dev";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
const src = (referrer, userAgent = DESKTOP) => sourceBucket({ referrer, host: HOST, userAgent });

test("no referrer is a direct visit", () => {
  assert.equal(src(""), "direct");
});

test("a reload or in-site hop does not count as a new source", () => {
  assert.equal(src(`https://${HOST}/`), "direct");
});

test("search engines are recognised across their country domains", () => {
  for (const referrer of [
    "https://www.google.com/", "https://www.google.co.th/", "https://www.bing.com/search?q=x",
    "https://search.yahoo.co.jp/", "https://duckduckgo.com/", "https://yandex.ru/",
    "https://www.ecosia.org/", "https://search.brave.com/search?q=pdf",
  ]) {
    assert.equal(src(referrer), "search", referrer);
  }
});

test("LINE and Facebook are recognised by referrer", () => {
  assert.equal(src("https://line.me/R/"), "line");
  assert.equal(src("https://l.facebook.com/l.php?u=x"), "facebook");
  assert.equal(src("https://lm.facebook.com/"), "facebook");
  assert.equal(src("https://www.messenger.com/"), "facebook");
});

test("in-app browsers are recognised even with no referrer at all", () => {
  // Thai users mostly open shared links inside LINE, which sends none.
  const line = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/14.3.0";
  const facebook = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.1;]";
  assert.equal(src("", line), "line");
  assert.equal(src("", facebook), "facebook");
});

test("a word merely containing 'Line' is not the LINE app", () => {
  assert.equal(src("", "Mozilla/5.0 Pipeline/2.0 Headline/3"), "direct");
});

test("lookalike domains are not mistaken for the real ones", () => {
  assert.equal(src("https://notgoogle.example.com/"), "other");
  assert.equal(src("https://google.com.evil.example/"), "other");
  assert.equal(src("https://facebook.com.phish.example/"), "other");
});

test("an unparseable referrer is 'other', not a crash", () => {
  assert.equal(src("not a url"), "other");
});

test("every source the function can return is in the published vocabulary", () => {
  for (const referrer of ["", "https://google.com", "https://line.me", "https://fb.com", "https://x.example", "bad"]) {
    assert.ok(SOURCE_BUCKETS.includes(src(referrer)));
  }
});

// ------------------------------------------------------------ the server gate --

test("well-formed events are accepted", () => {
  assert.deepEqual(parseUsageEvent({ kind: "visit", source: "search" }), { kind: "visit", source: "search" });
  assert.deepEqual(
    parseUsageEvent({ kind: "run", tool: "merge", outcome: "success", pages: "6-20" }),
    { kind: "run", tool: "merge", outcome: "success", pages: "6-20" },
  );
});

test("every combination in the vocabularies is accepted", () => {
  for (const tool of USAGE_TOOLS) {
    for (const outcome of USAGE_OUTCOMES) {
      for (const pages of PAGE_BUCKETS) {
        assert.ok(parseUsageEvent({ kind: "run", tool, outcome, pages }), `${tool}/${outcome}/${pages}`);
      }
    }
  }
});

test("an extra field is refused, so nothing else can be smuggled into storage", () => {
  assert.equal(parseUsageEvent({ kind: "visit", source: "direct", fileName: "สัญญา.pdf" }), null);
  assert.equal(parseUsageEvent({ kind: "run", tool: "merge", outcome: "success", pages: "1", size: 12345 }), null);
  assert.equal(parseUsageEvent({ kind: "run", tool: "merge", outcome: "success", pages: "1", userId: "abc" }), null);
});

test("a missing field is refused", () => {
  assert.equal(parseUsageEvent({ kind: "visit" }), null);
  assert.equal(parseUsageEvent({ kind: "run", tool: "merge", outcome: "success" }), null);
});

test("values outside the vocabularies are refused", () => {
  assert.equal(parseUsageEvent({ kind: "visit", source: "https://google.com" }), null);
  assert.equal(parseUsageEvent({ kind: "run", tool: "delete-everything", outcome: "success", pages: "1" }), null);
  assert.equal(parseUsageEvent({ kind: "run", tool: "merge", outcome: "maybe", pages: "1" }), null);
  assert.equal(parseUsageEvent({ kind: "run", tool: "merge", outcome: "success", pages: "37" }), null, "an exact page count is not a bucket");
  assert.equal(parseUsageEvent({ kind: "run", tool: "merge", outcome: "success", pages: 1 }), null);
});

test("anything that is not an event object is refused", () => {
  for (const value of [null, undefined, "visit", 42, [], ["kind", "visit"], { kind: "pageview" }]) {
    assert.equal(parseUsageEvent(value), null, JSON.stringify(value));
  }
});

// --------------------------------------------------------------- storage row --

test("the server keeps the UTC day and nothing finer", () => {
  assert.equal(usageDay(new Date("2026-10-01T23:59:59+07:00")), "2026-10-01");
  assert.equal(usageDay(new Date("2026-10-02T06:30:00+07:00")), "2026-10-01", "Bangkok morning is still the UTC day before");
  assert.match(usageDay(new Date()), /^\d{4}-\d{2}-\d{2}$/);
});

test("a row is exactly the five counted columns", () => {
  assert.deepEqual(usageRow({ kind: "visit", source: "line" }, "2026-10-01"), ["2026-10-01", "visit", "", "", "line"]);
  assert.deepEqual(
    usageRow({ kind: "run", tool: "compress", outcome: "failure", pages: "101+" }, "2026-10-01"),
    ["2026-10-01", "run", "compress", "failure", "101+"],
  );
});

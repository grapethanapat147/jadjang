import assert from "node:assert/strict";
import test from "node:test";
import { handleUsage } from "../worker/usage.ts";
import { USAGE_SCHEMA_SQL, USAGE_UPSERT_SQL } from "../app/lib/usage.ts";

const URL_ = "https://jadjang.grapethanapat147.workers.dev/api/usage";
const NOW = new Date("2026-10-01T05:00:00Z");

/** Records every statement, so the tests can see exactly what reached storage. */
function fakeDb({ failSchemaTimes = 0, failUpsert = false } = {}) {
  const calls = [];
  let schemaFailures = failSchemaTimes;
  return {
    calls,
    prepare(sql) {
      return {
        run: async () => {
          calls.push({ sql, values: [] });
          if (sql === USAGE_SCHEMA_SQL && schemaFailures > 0) {
            schemaFailures -= 1;
            throw new Error("schema unavailable");
          }
        },
        bind: (...values) => ({
          run: async () => {
            calls.push({ sql, values });
            if (failUpsert) throw new Error("write failed");
          },
        }),
      };
    },
  };
}

const post = (body, headers = {}) =>
  new Request(URL_, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://jadjang.grapethanapat147.workers.dev", ...headers },
  });

const VISIT = { kind: "visit", source: "search" };
const RUN = { kind: "run", tool: "merge", outcome: "success", pages: "2-5" };

// ------------------------------------------------------------- accepting --

test("a visit adds one to today's total for its source", async () => {
  const db = fakeDb();
  const res = await handleUsage(post(VISIT), db, NOW);
  assert.equal(res.status, 204);
  const upsert = db.calls.find((c) => c.sql === USAGE_UPSERT_SQL);
  assert.deepEqual(upsert.values, ["2026-10-01", "visit", "", "", "search"]);
});

test("a run adds one to today's total for its tool, outcome and bucket", async () => {
  const db = fakeDb();
  assert.equal((await handleUsage(post(RUN), db, NOW)).status, 204);
  const upsert = db.calls.find((c) => c.sql === USAGE_UPSERT_SQL);
  assert.deepEqual(upsert.values, ["2026-10-01", "run", "merge", "success", "2-5"]);
});

test("storage only ever receives the five counted columns", async () => {
  // The whole privacy promise rests on this: nothing beyond the bucketed
  // vocabulary and the day can reach the table.
  const db = fakeDb();
  await handleUsage(post(RUN), db, NOW);
  for (const call of db.calls.filter((c) => c.sql === USAGE_UPSERT_SQL)) {
    assert.equal(call.values.length, 5);
    for (const value of call.values) {
      assert.equal(typeof value, "string");
      assert.ok(value.length <= 12, `${value} is longer than any vocabulary word`);
    }
  }
});

test("the table is a running total, not a log of events", () => {
  assert.match(USAGE_UPSERT_SQL, /ON CONFLICT[\s\S]*DO UPDATE SET count = count \+ 1/);
  assert.doesNotMatch(USAGE_SCHEMA_SQL, /\b(ip|agent|referrer|session|user|time|created_at)\b/i);
});

test("responses are never cached", async () => {
  const res = await handleUsage(post(VISIT), fakeDb(), NOW);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// --------------------------------------------------------------- refusing --

test("only POST is accepted", async () => {
  const res = await handleUsage(new Request(URL_), fakeDb(), NOW);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
});

test("another site cannot post counts", async () => {
  const db = fakeDb();
  const res = await handleUsage(post(VISIT, { origin: "https://elsewhere.example" }), db, NOW);
  assert.equal(res.status, 403);
  assert.equal(db.calls.length, 0, "nothing may be written");
});

test("a browser that sends no Origin is let through", async () => {
  const req = new Request(URL_, { method: "POST", body: JSON.stringify(VISIT) });
  assert.equal((await handleUsage(req, fakeDb(), NOW)).status, 204);
});

test("an oversized body is refused before it is parsed", async () => {
  const db = fakeDb();
  const res = await handleUsage(post("x".repeat(300)), db, NOW);
  assert.equal(res.status, 413);
  assert.equal(db.calls.length, 0);
});

test("a lying Content-Length is caught by the real size", async () => {
  const db = fakeDb();
  const res = await handleUsage(post(JSON.stringify({ ...VISIT, pad: "x".repeat(400) }), { "content-length": "10" }), db, NOW);
  assert.ok([400, 413].includes(res.status));
  assert.equal(db.calls.length, 0);
});

test("malformed JSON and unknown events are refused without writing", async () => {
  for (const body of ["{", "null", JSON.stringify({ kind: "visit", source: "direct", fileName: "a.pdf" })]) {
    const db = fakeDb();
    const res = await handleUsage(post(body), db, NOW);
    assert.equal(res.status, 400, body);
    assert.equal(db.calls.length, 0, body);
  }
});

// ----------------------------------------------------------- degrading --

test("without the database the endpoint still answers, and counts nothing", async () => {
  assert.equal((await handleUsage(post(VISIT), undefined, NOW)).status, 204);
});

test("the table is created once per database, not on every request", async () => {
  const db = fakeDb();
  for (let i = 0; i < 5; i += 1) await handleUsage(post(VISIT), db, NOW);
  assert.equal(db.calls.filter((c) => c.sql === USAGE_SCHEMA_SQL).length, 1);
  assert.equal(db.calls.filter((c) => c.sql === USAGE_UPSERT_SQL).length, 5);
});

test("a failed table creation is retried by the next request", async () => {
  const db = fakeDb({ failSchemaTimes: 1 });
  assert.equal((await handleUsage(post(VISIT), db, NOW)).status, 500);
  assert.equal((await handleUsage(post(VISIT), db, NOW)).status, 204, "a cached failure would never recover");
});

test("a failed write is reported as a server error, not swallowed as success", async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    assert.equal((await handleUsage(post(VISIT), fakeDb({ failUpsert: true }), NOW)).status, 500);
  } finally {
    console.error = original;
  }
});

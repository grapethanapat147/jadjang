/**
 * POST /api/usage — adds one to a daily running total.
 *
 * Kept free of Worker-only imports so the tests can drive it with a fake
 * database. Every rejection is cheap and says nothing about why beyond the
 * status code.
 */
import {
  USAGE_MAX_BODY_BYTES,
  USAGE_SCHEMA_SQL,
  USAGE_UPSERT_SQL,
  parseUsageEvent,
  usageDay,
  usageRow,
} from "../app/lib/usage.ts";

/** The slice of D1 this handler needs; a real D1Database satisfies it. */
export type UsageDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown> };
    run(): Promise<unknown>;
  };
};

const noStore = { "cache-control": "no-store" };
const reply = (status: number) => new Response(null, { status, headers: noStore });

/** Table creation runs once per database per isolate, not once per request. */
const schemaReady = new WeakMap<UsageDatabase, Promise<unknown>>();
function ensureSchema(db: UsageDatabase): Promise<unknown> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db.prepare(USAGE_SCHEMA_SQL).run().catch((error: unknown) => {
      // A failed attempt must not be cached, or the next request never retries.
      schemaReady.delete(db);
      throw error;
    });
    schemaReady.set(db, ready);
  }
  return ready;
}

export async function handleUsage(
  request: Request,
  db: UsageDatabase | undefined,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...noStore, allow: "POST" } });
  }

  // Same-origin only. A browser that sends no Origin is let through; one that
  // names another site is not.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return reply(403);
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > USAGE_MAX_BODY_BYTES) {
    return reply(413);
  }
  const body = await request.text();
  if (body.length > USAGE_MAX_BODY_BYTES) {
    return reply(413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return reply(400);
  }
  const event = parseUsageEvent(parsed);
  if (!event) {
    return reply(400);
  }

  // A deployment without the database still answers cleanly: the page never
  // waits on this, and counting is not worth an error.
  if (!db) {
    return reply(204);
  }

  try {
    await ensureSchema(db);
    await db.prepare(USAGE_UPSERT_SQL).bind(...usageRow(event, usageDay(now))).run();
  } catch (error) {
    console.error("usage count failed", error);
    return reply(500);
  }
  return reply(204);
}

/**
 * Anonymous, aggregate usage counting.
 *
 * Only two kinds of event ever leave the device, and every field in them comes
 * from one of the fixed vocabularies below. Nothing about a document — not the
 * file, its name, its size, its contents — and no identifier of any kind. The
 * server adds the day and nothing finer, and keeps only running totals.
 */

export const USAGE_TOOLS = ["organize", "merge", "split", "compress", "convert"] as const;
export type UsageTool = (typeof USAGE_TOOLS)[number];

export const USAGE_OUTCOMES = ["success", "failure"] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

/** Coarse on purpose: the exact page count of someone's document is not ours. */
export const PAGE_BUCKETS = ["1", "2-5", "6-20", "21-100", "101+"] as const;
export type PageBucket = (typeof PAGE_BUCKETS)[number];

/**
 * Where a visit came from, at the level that answers "search or shared link?".
 * LINE and Facebook get their own buckets because Thai users mostly open
 * shared links inside those apps, where the referrer is often blank.
 */
export const SOURCE_BUCKETS = ["direct", "search", "line", "facebook", "other"] as const;
export type SourceBucket = (typeof SOURCE_BUCKETS)[number];

export type UsageEvent =
  | { kind: "visit"; source: SourceBucket }
  | { kind: "run"; tool: UsageTool; outcome: UsageOutcome; pages: PageBucket };

/** Request bodies are a few dozen bytes; anything near this is not ours. */
export const USAGE_MAX_BODY_BYTES = 256;

export const USAGE_ENDPOINT = "/api/usage";

export function pageBucket(count: number): PageBucket {
  if (count <= 1) return "1";
  if (count <= 5) return "2-5";
  if (count <= 20) return "6-20";
  if (count <= 100) return "21-100";
  return "101+";
}

/**
 * Country domains spelled out (google.com, google.de, google.co.th,
 * google.com.au) rather than "anything after the dot", which would also accept
 * google.com.evil.example and quietly inflate the search count.
 */
const COUNTRY = "(com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})";
const SEARCH_HOSTS = [
  new RegExp(`(^|\\.)google\\.${COUNTRY}$`),
  /(^|\.)bing\.com$/,
  new RegExp(`(^|\\.)yahoo\\.${COUNTRY}$`),
  /(^|\.)duckduckgo\.com$/,
  new RegExp(`(^|\\.)yandex\\.${COUNTRY}$`),
  /(^|\.)baidu\.com$/,
  /(^|\.)ecosia\.org$/,
  /^search\.brave\.com$/,
];
const LINE_HOSTS = [/(^|\.)line\.me$/, /(^|\.)line\.naver\.jp$/];
const FACEBOOK_HOSTS = [/(^|\.)facebook\.com$/, /(^|\.)fb\.com$/, /(^|\.)messenger\.com$/];

/**
 * The user agent is read here only to pick a bucket; it is never sent. In-app
 * browsers are checked first because they usually send no referrer at all.
 */
export function sourceBucket(input: { referrer: string; host: string; userAgent: string }): SourceBucket {
  if (/\bLine\/\d/.test(input.userAgent)) return "line";
  if (/FBAN|FBAV|FB_IAB/.test(input.userAgent)) return "facebook";
  if (!input.referrer) return "direct";

  let host: string;
  try {
    host = new URL(input.referrer).hostname.toLowerCase();
  } catch {
    return "other";
  }

  // A reload or an in-site hop is not a new source.
  if (host === input.host.toLowerCase()) return "direct";
  if (SEARCH_HOSTS.some((pattern) => pattern.test(host))) return "search";
  if (LINE_HOSTS.some((pattern) => pattern.test(host))) return "line";
  if (FACEBOOK_HOSTS.some((pattern) => pattern.test(host))) return "facebook";
  return "other";
}

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

function hasExactly(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((key, index) => key === [...keys].sort()[index]);
}

/**
 * The server's gate. Exact keys and allow-listed values only, so a forged or
 * buggy request cannot slip any other field into storage.
 */
export function parseUsageEvent(value: unknown): UsageEvent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;

  if (event.kind === "visit") {
    if (!hasExactly(event, ["kind", "source"])) return null;
    return includes(SOURCE_BUCKETS, event.source) ? { kind: "visit", source: event.source } : null;
  }

  if (event.kind === "run") {
    if (!hasExactly(event, ["kind", "tool", "outcome", "pages"])) return null;
    if (!includes(USAGE_TOOLS, event.tool)) return null;
    if (!includes(USAGE_OUTCOMES, event.outcome)) return null;
    if (!includes(PAGE_BUCKETS, event.pages)) return null;
    return { kind: "run", tool: event.tool, outcome: event.outcome, pages: event.pages };
  }

  return null;
}

/** The only time the server keeps: the UTC day. */
export function usageDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** One table of running totals. There are no per-event rows to leak. */
export const USAGE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT NOT NULL,
  outcome TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, tool, outcome, bucket)
)`;

export const USAGE_UPSERT_SQL = `INSERT INTO usage_daily (day, kind, tool, outcome, bucket, count)
VALUES (?1, ?2, ?3, ?4, ?5, 1)
ON CONFLICT (day, kind, tool, outcome, bucket) DO UPDATE SET count = count + 1`;

/** The five columns an event increments. Visits leave tool and outcome empty. */
export function usageRow(event: UsageEvent, day: string): [string, string, string, string, string] {
  return event.kind === "visit"
    ? [day, "visit", "", "", event.source]
    : [day, "run", event.tool, event.outcome, event.pages];
}

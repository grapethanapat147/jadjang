import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
);

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString(), "PNG", "not a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// ------------------------------------------------------------- manifest --

test("declares what a browser needs to offer installation", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.lang, "th");
  assert.ok(manifest.name && manifest.short_name, "needs both names");
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});

test("ships the icon sizes installation actually requires", async (t) => {
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
    assert.ok(icon, `no ${size}px icon declared`);

    await t.test(`${size}px icon file matches its declaration`, async () => {
      const file = await readFile(new URL(`../public${icon.src}`, import.meta.url));
      assert.deepEqual(pngSize(file), { width: size, height: size });
    });
  }
});

test("offers a maskable icon so Android does not letterbox it", () => {
  const maskable = manifest.icons.filter((icon) => icon.purpose === "maskable");
  assert.ok(maskable.length > 0, "at least one maskable icon");
  assert.ok(
    maskable.every((icon) => Number(icon.sizes.split("x")[0]) >= 192),
    "maskable icons must be at least 192px",
  );
});

// ------------------------------------------------------- service worker --

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://jadjang.example";

function loadWorker() {
  const listeners = {};
  const context = {
    self: {
      addEventListener: (type, handler) => {
        listeners[type] = handler;
      },
      location: { origin: ORIGIN },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: { open: async () => ({}), keys: async () => [], delete: async () => {} },
    fetch: async () => ({ ok: true }),
    URL,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  // `const` declarations stay in the context's lexical scope rather than on the
  // global object, so they are read by evaluating them there.
  const read = (expression) => vm.runInContext(expression, context);
  return { context, listeners, read };
}

const request = (url, extra = {}) => ({ method: "GET", url, mode: "no-cors", ...extra });

test("registers the lifecycle handlers a worker needs", () => {
  const { listeners } = loadWorker();
  assert.deepEqual(Object.keys(listeners).sort(), ["activate", "fetch", "install"]);
});

test("serves immutable hashed assets from cache", () => {
  const { context } = loadWorker();
  assert.equal(
    context.strategyFor(request(`${ORIGIN}/_next/static/chunks/page-abc123.js`), ORIGIN),
    "cache-first",
  );
});

test("always tries the network for the page itself", () => {
  const { context } = loadWorker();
  // Stale HTML would name hashed chunks that no longer exist after a deploy.
  assert.equal(
    context.strategyFor(request(`${ORIGIN}/`, { mode: "navigate" }), ORIGIN),
    "network-first",
  );
});

test("revalidates unhashed assets in the background", () => {
  const { context } = loadWorker();
  for (const path of ["/tool-icons/merge.png", "/favicon.svg", "/manifest.webmanifest"]) {
    assert.equal(context.strategyFor(request(ORIGIN + path), ORIGIN), "stale-while-revalidate", path);
  }
});

test("keeps its hands off requests it has no business caching", () => {
  const { context } = loadWorker();
  assert.equal(
    context.strategyFor(request(`${ORIGIN}/`, { method: "POST" }), ORIGIN),
    "bypass",
    "non-GET",
  );
  assert.equal(
    context.strategyFor(request("https://fonts.example/font.woff2"), ORIGIN),
    "bypass",
    "cross-origin",
  );
});

test("precaches the shell and every tool icon the picker shows", () => {
  const { read } = loadWorker();
  const precache = read("PRECACHE");
  const toolIcons = ["organize", "merge", "split", "compress", "convert"].map(
    (tool) => `/tool-icons/${tool}.png`,
  );
  for (const entry of ["/", "/manifest.webmanifest", ...toolIcons]) {
    assert.ok(precache.includes(entry), `${entry} must be precached`);
  }
});

test("names its cache with a version it can retire", () => {
  const { read } = loadWorker();
  // activate() deletes every cache that is not this one, so bumping the version
  // is what evicts a bad build.
  assert.match(read("CACHE"), /^jadjang-v\d+$/);
});

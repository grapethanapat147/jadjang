import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://jadjang.example";

/** Minimal Cache Storage backed by a Map, enough to run the worker for real. */
function createCacheStorage(network) {
  const stores = new Map();
  const keyOf = (input) =>
    new URL(typeof input === "string" ? input : input.url, ORIGIN).href;

  const makeCache = () => {
    const entries = new Map();
    return {
      entries,
      async put(request, response) {
        entries.set(keyOf(request), response);
      },
      async match(request) {
        return entries.get(keyOf(request));
      },
      async add(url) {
        const response = await network.fetch(new Request(new URL(url, ORIGIN)));
        if (!response.ok) throw new Error(`cache.add failed for ${url}`);
        entries.set(keyOf(url), response);
      },
      async keys() {
        return [...entries.keys()].map((url) => new Request(url));
      },
    };
  };

  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, makeCache());
      return stores.get(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
}

/** A server whose network can be switched off mid-test. */
function createNetwork(files) {
  const state = { online: true, requests: [] };
  return {
    state,
    async fetch(input) {
      const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
      state.requests.push(url.pathname);
      if (!state.online) throw new TypeError("Failed to fetch");
      const body = files.get(url.pathname);
      if (body === undefined) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    },
  };
}

async function bootWorker(files) {
  const network = createNetwork(files);
  const caches = createCacheStorage(network);
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
    caches,
    fetch: (input) => network.fetch(input),
    URL,
    Request,
    Response,
    Promise,
    TypeError,
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  // run install to completion, the way a browser would
  const pending = [];
  await listeners.install({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);

  const respond = async (request) => {
    let responded;
    listeners.fetch({ request, respondWith: (promise) => { responded = promise; } });
    return responded === undefined ? undefined : responded;
  };

  return { network, caches, listeners, respond, context };
}

/**
 * Only a browser can construct a navigate-mode Request, so page loads are
 * represented by the same shape the worker actually reads.
 */
const navigation = (url) => ({ method: "GET", url, mode: "navigate" });

const PAGE = "<!doctype html><title>จัดแจง</title>";
const files = new Map([
  ["/", PAGE],
  ["/favicon.svg", "<svg/>"],
  ["/icon-192.png", "png192"],
  ["/icon-512.png", "png512"],
  ["/apple-touch-icon.png", "png180"],
  ["/manifest.webmanifest", "{}"],
  ["/tool-icons/organize.png", "organize"],
  ["/tool-icons/merge.png", "merge"],
  ["/tool-icons/split.png", "split"],
  ["/tool-icons/compress.png", "compress"],
  ["/tool-icons/convert.png", "convert"],
  ["/_next/static/chunks/page-abc.js", "page chunk"],
  ["/_next/static/media/pdf.worker.min.xyz.mjs", "pdf worker"],
]);

test("install fills the cache with the shell", async () => {
  const { caches } = await bootWorker(files);
  const cache = await caches.open("jadjang-v1");
  const paths = (await cache.keys()).map((request) => new URL(request.url).pathname);
  assert.ok(paths.includes("/"), "the page itself");
  assert.ok(paths.includes("/tool-icons/convert.png"), "tool icons");
  assert.equal(paths.length, 11);
});

test("the app still loads with the network off", async () => {
  const worker = await bootWorker(files);
  worker.network.state.online = false;

  const response = await worker.respond(navigation(`${ORIGIN}/`));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), PAGE, "served the precached page");
});

test("a chunk fetched while online is available after the network drops", async () => {
  const worker = await bootWorker(files);
  const path = "/_next/static/chunks/page-abc.js";

  const online = await worker.respond(new Request(ORIGIN + path));
  assert.equal(await online.text(), "page chunk");

  worker.network.state.online = false;
  const offline = await worker.respond(new Request(ORIGIN + path));
  assert.equal(await offline.text(), "page chunk", "same chunk, now from cache");
});

test("the heavy PDF code works offline once it has been used online", async () => {
  const worker = await bootWorker(files);
  const path = "/_next/static/media/pdf.worker.min.xyz.mjs";

  // Not precached — it is only fetched when a user first opens a PDF.
  worker.network.state.online = false;
  await assert.rejects(
    () => worker.respond(new Request(ORIGIN + path)),
    /Failed to fetch/,
    "offline before it was ever loaded, there is nothing to serve",
  );

  worker.network.state.online = true;
  await worker.respond(new Request(ORIGIN + path));

  worker.network.state.online = false;
  const after = await worker.respond(new Request(ORIGIN + path));
  assert.equal(await after.text(), "pdf worker");
});

test("an immutable asset is served from cache without hitting the network twice", async () => {
  const worker = await bootWorker(files);
  const path = "/_next/static/chunks/page-abc.js";

  await worker.respond(new Request(ORIGIN + path));
  const afterFirst = worker.network.state.requests.filter((p) => p === path).length;
  await worker.respond(new Request(ORIGIN + path));
  const afterSecond = worker.network.state.requests.filter((p) => p === path).length;

  assert.equal(afterFirst, 1);
  assert.equal(afterSecond, 1, "the second read must not touch the network");
});

test("the page is re-fetched while online so a deploy is picked up", async () => {
  const worker = await bootWorker(files);

  files.set("/", "<!doctype html><title>ใหม่</title>");
  const response = await worker.respond(navigation(`${ORIGIN}/`));
  assert.match(await response.text(), /ใหม่/, "network-first must win over the precached copy");
  files.set("/", PAGE);
});

test("activate clears caches left by an older version", async () => {
  const worker = await bootWorker(files);
  await worker.caches.open("jadjang-v0");
  assert.ok((await worker.caches.keys()).includes("jadjang-v0"));

  const pending = [];
  await worker.listeners.activate({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);

  assert.deepEqual(await worker.caches.keys(), ["jadjang-v1"]);
});

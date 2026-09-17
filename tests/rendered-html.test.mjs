import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders only the tool picker and quick preview workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="th">/i);
  assert.match(html, /<title>จัดแจง — จัดเอกสารให้พร้อมส่ง<\/title>/i);
  assert.match(html, /เลือกสิ่งที่ต้องการทำ/);
  assert.match(html, /Quick Preview/);
  assert.match(html, /ประมวลผลในเบราว์เซอร์/);
  assert.match(html, /จัดหน้า PDF/);
  assert.match(html, /รวม PDF/);
  assert.match(html, /แยกหน้า/);
  assert.match(html, /บีบอัด/);
  assert.match(html, /แปลงไฟล์/);
  assert.match(html, /\/tool-icons\/organize\.png/);
  assert.match(html, /\/tool-icons\/convert\.png/);
  assert.match(html, /type="file"/);
  assert.match(html, /accept="application\/pdf,image\/jpeg,image\/png/);
  assert.doesNotMatch(html, /Privacy by design|Incremental delivery|แผนคุณภาพ/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("emits site-specific social metadata", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /property="og:title" content="จัดแจง — จัดเอกสารให้พร้อมส่ง"/i);
  assert.match(html, /property="og:image" content="http:\/\/localhost\/og-jadjang\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
});

test("ships the live regions empty so later messages are announced", async () => {
  const html = await (await render()).text();

  // A live region added to the page together with its text is not announced,
  // so both regions must already be present, and empty, on first render.
  const announcers = [...html.matchAll(/<div class="live-announcer"[^>]*>(.*?)<\/div>/g)];
  assert.equal(announcers.length, 2, "one assertive and one polite region");
  for (const [, contents] of announcers) {
    assert.equal(contents, "", "regions must start empty");
  }

  assert.match(html, /<div class="live-announcer" role="alert" aria-live="assertive">/);
  assert.match(html, /<div class="live-announcer" role="status" aria-live="polite">/);

  // The visible notice and progress boxes must not double as live regions.
  assert.doesNotMatch(html, /class="notice-wrap"[^>]*aria-live/);
  assert.doesNotMatch(html, /class="progress-box"[^>]*aria-live/);
});

test("wires the tool tablist to a real tab panel", async () => {
  const html = await (await render()).text();

  const tabs = [...html.matchAll(/role="tab"/g)];
  assert.equal(tabs.length, 5, "one tab per tool");

  const panels = [...html.matchAll(/role="tabpanel"/g)];
  assert.equal(panels.length, 1, "exactly one panel");
  assert.match(html, /id="quick-preview"[^>]*role="tabpanel"/);

  const controls = [...html.matchAll(/aria-controls="quick-preview"/g)];
  assert.equal(controls.length, tabs.length, "every tab points at that panel");
});

test("exposes a single tab stop so arrow keys own the tablist", async () => {
  const html = await (await render()).text();

  const reachable = [...html.matchAll(/role="tab"[^>]*tabindex="0"/g)];
  const skipped = [...html.matchAll(/role="tab"[^>]*tabindex="-1"/g)];

  assert.equal(reachable.length, 1, "only the selected tool is in the tab order");
  assert.equal(skipped.length, 4, "the rest are reached with arrow keys");
  assert.match(html, /id="tool-tab-organize"[^>]*aria-selected="true"/);
});

test("advertises itself as an installable app, from inside <head>", async () => {
  const html = await (await render()).text();
  const head = html.slice(html.indexOf("<head"), html.indexOf("</head>"));

  // Position matters: a browser looks in <head> when deciding installability,
  // and the framework emits metadata late in the body where it would be missed.
  assert.match(head, /<link rel="manifest" href="\/manifest\.webmanifest"\s*\/?>/);
  assert.match(head, /<meta name="theme-color" content="#4263eb"\s*\/?>/);
  assert.match(head, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"\s*\/?>/);
  // iOS uses these for the home-screen launch rather than the manifest.
  assert.match(head, /<meta name="apple-mobile-web-app-capable" content="yes"\s*\/?>/);
  assert.match(head, /<meta name="apple-mobile-web-app-title" content="จัดแจง"\s*\/?>/);

  const manifestLinks = html.match(/rel="manifest"/g) ?? [];
  assert.equal(manifestLinks.length, 1, "exactly one manifest link");
});

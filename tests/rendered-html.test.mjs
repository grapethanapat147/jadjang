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

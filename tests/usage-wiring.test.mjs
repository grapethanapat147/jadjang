import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const page = await read("app/page.tsx");
const worker = await read("worker/index.ts");
const vite = await read("vite.config.ts");
const guide = await read("CLAUDE.md");

test("the page tells the user what is counted, next to the privacy promise", () => {
  assert.match(page, /className="usage-note"/);
  assert.match(page, /ไม่เก็บไฟล์ ชื่อไฟล์ หรือข้อมูลที่ระบุตัวคุณ/);
  assert.ok(
    page.indexOf('className="usage-note"') > page.indexOf('className="privacy-note"'),
    "the disclosure qualifies the promise, so it sits right after it",
  );
});

test("every report the page makes is built from the vocabularies", () => {
  const calls = [...page.matchAll(/reportUsage\(([^;]+)\);/g)].map((m) => m[1]);
  assert.equal(calls.length, 2, "one for success, one for failure");
  for (const call of calls) {
    assert.match(call, /kind: "run", tool: activeTool, outcome: "(success|failure)", pages: pageBucket\(pages\.length\)/);
  }
});

test("the page never reports anything about the files themselves", () => {
  const reports = [...page.matchAll(/report(Usage|VisitOnce)\(([\s\S]*?)\);/g)].map((m) => m[2]).join("\n");
  for (const forbidden of ["fileName", "name", "size", "bytes", "sources", "previewUrl", "result"]) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(reports), `${forbidden} appears in a usage report`);
  }
});

test("the worker routes the endpoint before handing off to the app", () => {
  assert.ok(worker.indexOf("USAGE_ENDPOINT") < worker.indexOf("handler.fetch"));
  assert.match(worker, /handleUsage\(request, env\.USAGE_DB\)/);
});

test("the binding is declared where the deploy config is generated from", () => {
  assert.match(vite, /binding: "USAGE_DB"/);
  assert.match(vite, /database_name: "jadjang-usage"/);
  assert.match(vite, /database_id: "[0-9a-f-]{36}"/);
});

test("the project guide no longer says the site stores nothing", () => {
  assert.doesNotMatch(guide, /No D1, R2 or KV binding is needed/);
  assert.match(guide, /USAGE_DB/);
});

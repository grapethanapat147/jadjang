import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  buildPdf,
  movePage,
  splitPdfPages,
  validateInputFiles,
} from "../app/lib/pdf-engine.ts";

async function samplePdf(pageCount) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([595, 842]);
  }
  return (await document.save()).buffer;
}

test("validates supported types and size guardrails", () => {
  assert.equal(validateInputFiles([{ name: "report.pdf", size: 1000, type: "application/pdf" }]), null);
  assert.match(
    validateInputFiles([{ name: "malware.exe", size: 1000, type: "application/octet-stream" }]),
    /ยังไม่รองรับ/,
  );
});

test("reorders pages without mutating the input", () => {
  const original = ["a", "b", "c"];
  assert.deepEqual(movePage(original, 0, 2), ["b", "c", "a"]);
  assert.deepEqual(original, ["a", "b", "c"]);
});

test("merges and verifies the requested page order", async () => {
  const first = await samplePdf(2);
  const second = await samplePdf(1);
  const sources = [
    { id: "one", name: "one.pdf", type: "pdf", bytes: first, size: first.byteLength },
    { id: "two", name: "two.pdf", type: "pdf", bytes: second, size: second.byteLength },
  ];
  const pages = [
    { id: "p3", sourceId: "two", pageNumber: 1, rotation: 0 },
    { id: "p1", sourceId: "one", pageNumber: 1, rotation: 90 },
    { id: "p2", sourceId: "one", pageNumber: 2, rotation: 0 },
  ];
  const output = await buildPdf(sources, pages);
  const verified = await PDFDocument.load(output);
  assert.equal(verified.getPageCount(), 3);
  assert.equal(verified.getPage(1).getRotation().angle, 90);
});

test("splits selected pages into one-page PDFs", async () => {
  const bytes = await samplePdf(2);
  const source = { id: "source", name: "source.pdf", type: "pdf", bytes, size: bytes.byteLength };
  const pages = [
    { id: "p1", sourceId: "source", pageNumber: 1, rotation: 0 },
    { id: "p2", sourceId: "source", pageNumber: 2, rotation: 0 },
  ];
  const results = await splitPdfPages([source], pages);
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), 1);
  }
});

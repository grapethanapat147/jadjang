import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  A4_LONG_EDGE,
  A4_SHORT_EDGE,
  IMAGE_PAGE_MARGIN,
  buildPdf,
  fillPageBox,
  findOrphanedSourceIds,
  fitImageOnA4,
  hasEveryPage,
  mimeTypeForSource,
  movePage,
  splitEntryName,
  splitPdfPages,
  validateInputFiles,
  verifyPdfPageCount,
} from "../app/lib/pdf-engine.ts";

// Smallest valid PNG (1x1, opaque) so image paths can be exercised without a browser.
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngSource() {
  const buffer = Buffer.from(ONE_PIXEL_PNG, "base64");
  return {
    id: "image",
    name: "photo.png",
    type: "png",
    bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    size: buffer.byteLength,
    pageCount: 1,
  };
}

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
    { id: "one", name: "one.pdf", type: "pdf", bytes: first, size: first.byteLength, pageCount: 2 },
    { id: "two", name: "two.pdf", type: "pdf", bytes: second, size: second.byteLength, pageCount: 1 },
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
  const source = { id: "source", name: "source.pdf", type: "pdf", bytes, size: bytes.byteLength, pageCount: 2 };
  const pages = [
    { id: "p1", sourceId: "source", pageNumber: 1, rotation: 0 },
    { id: "p2", sourceId: "source", pageNumber: 2, rotation: 0 },
  ];
  const results = await splitPdfPages(
    [source],
    pages.map((page, index) => ({ page, position: index + 1 })),
  );
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), 1);
  }
});

test("keeps compressed image pages on A4 instead of raw pixel sizes", () => {
  // Regression: a 12MP photo used to become a 4000 x 3000 pt (55 x 41 inch) page.
  const box = fitImageOnA4(4000, 3000);

  assert.equal(box.pageWidth, A4_LONG_EDGE, "a landscape photo gets a landscape page");
  assert.equal(box.pageHeight, A4_SHORT_EDGE);
  assert.ok(box.drawWidth <= box.pageWidth - IMAGE_PAGE_MARGIN * 2 + 1e-9, "stays inside the margin");
  assert.ok(box.drawHeight <= box.pageHeight - IMAGE_PAGE_MARGIN * 2 + 1e-9);
  assert.ok(Math.abs(box.drawWidth / box.drawHeight - 4000 / 3000) < 1e-9, "keeps aspect ratio");
  assert.ok(Math.abs(box.x * 2 + box.drawWidth - box.pageWidth) < 1e-9, "centered horizontally");
  assert.ok(Math.abs(box.y * 2 + box.drawHeight - box.pageHeight) < 1e-9, "centered vertically");
});

test("gives portrait images a portrait A4 page", () => {
  const box = fitImageOnA4(1200, 1600);
  assert.equal(box.pageWidth, A4_SHORT_EDGE);
  assert.equal(box.pageHeight, A4_LONG_EDGE);
});

test("leaves PDF page dimensions untouched", () => {
  assert.deepEqual(fillPageBox(A4_SHORT_EDGE, A4_LONG_EDGE), {
    pageWidth: A4_SHORT_EDGE,
    pageHeight: A4_LONG_EDGE,
    drawWidth: A4_SHORT_EDGE,
    drawHeight: A4_LONG_EDGE,
    x: 0,
    y: 0,
  });
});

test("still accepts an already added file that has no extension", () => {
  // Scanners and mobile share sheets hand over files with a MIME type but no extension.
  const firstUpload = [{ name: "scan", size: 1000, type: "application/pdf" }];
  assert.equal(validateInputFiles(firstUpload), null);

  // Adding more files re-validates the sources already in the workspace.
  const secondUpload = [
    { name: "scan", size: 1000, type: mimeTypeForSource("pdf") },
    { name: "second.pdf", size: 1000, type: "application/pdf" },
  ];
  assert.equal(validateInputFiles(secondUpload), null);
});

test("maps every source type to a real MIME type", () => {
  assert.equal(mimeTypeForSource("pdf"), "application/pdf");
  assert.equal(mimeTypeForSource("png"), "image/png");
  assert.equal(mimeTypeForSource("jpg"), "image/jpeg");
});

test("builds image PDFs on A4 pages", async () => {
  const source = pngSource();
  const output = await buildPdf([source], [
    { id: "p1", sourceId: source.id, pageNumber: 1, rotation: 0 },
  ]);

  const verified = await PDFDocument.load(output);
  assert.equal(verified.getPageCount(), 1);
  const { width, height } = verified.getPage(0).getSize();
  assert.ok(Math.abs(width - A4_SHORT_EDGE) < 0.01, `expected A4 width, got ${width}`);
  assert.ok(Math.abs(height - A4_LONG_EDGE) < 0.01, `expected A4 height, got ${height}`);
});

test("reports the sources that no remaining page uses", () => {
  const sourceIds = ["one", "two", "three"];
  const remainingPages = [
    { sourceId: "one" },
    { sourceId: "three" },
  ];
  assert.deepEqual(findOrphanedSourceIds(sourceIds, remainingPages), ["two"]);
});

test("reports every source once the last page is gone", () => {
  assert.deepEqual(findOrphanedSourceIds(["one", "two"], []), ["one", "two"]);
});

test("keeps a source that still has another page", () => {
  const pages = [{ sourceId: "one" }, { sourceId: "one" }];
  assert.deepEqual(findOrphanedSourceIds(["one"], pages), []);
});

test("accepts a result whose page count matches", async () => {
  const bytes = new Uint8Array(await samplePdf(3));
  await verifyPdfPageCount(bytes, 3);
});

test("blocks a result whose page count is short", async () => {
  const bytes = new Uint8Array(await samplePdf(2));
  await assert.rejects(() => verifyPdfPageCount(bytes, 3), /มี 2 หน้า แต่ควรมี 3 หน้า/);
});

test("blocks a split file that is not a single page", async () => {
  const bytes = new Uint8Array(await samplePdf(2));
  await assert.rejects(() => verifyPdfPageCount(bytes, 1), /หยุดดาวน์โหลด/);
});

test("names split files after the page numbers the user saw", async () => {
  const bytes = await samplePdf(3);
  const source = { id: "source", name: "source.pdf", type: "pdf", bytes, size: bytes.byteLength, pageCount: 3 };
  const pages = [1, 2, 3].map((pageNumber) => ({
    id: `p${pageNumber}`,
    sourceId: "source",
    pageNumber,
    rotation: 0,
  }));

  // Picking pages 1 and 3 must not produce page-01 and page-02.
  const results = await splitPdfPages(source ? [source] : [], [
    { page: pages[0], position: 1 },
    { page: pages[2], position: 3 },
  ]);
  assert.deepEqual(results.map((result) => result.name), ["page-01.pdf", "page-03.pdf"]);
});

test("pads split file names so they stay sortable", () => {
  assert.equal(splitEntryName(1, 9), "page-01.pdf");
  assert.equal(splitEntryName(7, 99), "page-07.pdf");
  assert.equal(splitEntryName(7, 100), "page-007.pdf");
  assert.equal(splitEntryName(250, 250), "page-250.pdf");
});

test("knows when the workspace still holds every page that was read", () => {
  const sources = [
    { id: "doc", pageCount: 3 },
    { id: "photo", pageCount: 1 },
  ];
  const allPages = [
    { sourceId: "doc" },
    { sourceId: "doc" },
    { sourceId: "doc" },
    { sourceId: "photo" },
  ];

  assert.equal(hasEveryPage(sources, allPages), true);
  assert.equal(hasEveryPage(sources, allPages.slice(1)), false, "a deleted page breaks the comparison");
  assert.equal(hasEveryPage([], []), true);
});

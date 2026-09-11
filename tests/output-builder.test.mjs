import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import {
  COMPRESSION_SETTINGS,
  MAX_PNG_PAGES,
  buildCompressedPdf,
  buildImageArchive,
  compressionNote,
  imageEntryName,
} from "../app/lib/output-builder.ts";
import { verifyArchiveEntryCount } from "../app/lib/verify-output.ts";

const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const A4_BOX = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  drawWidth: 547.28,
  drawHeight: 793.89,
  x: 24,
  y: 24,
};

function makePages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    sourceId: "source",
    pageNumber: index + 1,
    rotation: 0,
  }));
}

/**
 * Stands in for the browser. Only rasterising and encoding need a canvas, so
 * faking those two exercises the whole builder in Node.
 */
function stubDeps(overrides = {}) {
  const renderCalls = [];
  const encodeCalls = [];
  const progress = [];
  let yields = 0;

  return {
    renderCalls,
    encodeCalls,
    progress,
    yieldCount: () => yields,
    deps: {
      renderPage: async (page, scale) => {
        renderCalls.push({ id: page.id, scale });
        return { canvas: `canvas:${page.id}`, pageBox: overrides.pageBox ?? A4_BOX };
      },
      encode: async (canvas, mimeType, quality) => {
        encodeCalls.push({ canvas, mimeType, quality });
        if (overrides.encodeBytes) {
          return new Blob([overrides.encodeBytes(encodeCalls.length - 1)]);
        }
        return new Blob([mimeType === "image/png" ? ONE_PIXEL_PNG : ONE_PIXEL_JPEG]);
      },
      reportProgress: (label, percent) => progress.push({ label, percent }),
      yieldControl: async () => {
        yields += 1;
      },
    },
  };
}

// ---------------------------------------------------------------- convert --

test("packs one image per page, in page order", async () => {
  const stub = stubDeps();
  const { blob, entryCount } = await buildImageArchive(makePages(3), "jpg", stub.deps);

  assert.equal(entryCount, 3);
  const names = Object.keys((await JSZip.loadAsync(await blob.arrayBuffer())).files);
  assert.deepEqual(names, ["page-001.jpg", "page-002.jpg", "page-003.jpg"]);
  assert.deepEqual(stub.renderCalls.map((call) => call.id), ["p1", "p2", "p3"]);
});

test("produces an archive that passes the download-time check", async () => {
  const stub = stubDeps();
  const { blob, entryCount } = await buildImageArchive(makePages(4), "jpg", stub.deps);
  await verifyArchiveEntryCount(blob, entryCount);
  await assert.rejects(() => verifyArchiveEntryCount(blob, entryCount + 1), /แต่ควรมี 5 ไฟล์/);
});

test("stores the encoded bytes rather than an empty entry", async () => {
  const stub = stubDeps();
  const { blob } = await buildImageArchive(makePages(1), "png", stub.deps);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const stored = await zip.file("page-001.png").async("uint8array");
  assert.deepEqual(Buffer.from(stored), ONE_PIXEL_PNG);
});

test("asks the browser for the format it is packing", async () => {
  const jpg = stubDeps();
  await buildImageArchive(makePages(1), "jpg", jpg.deps);
  assert.deepEqual(jpg.encodeCalls[0], {
    canvas: "canvas:p1",
    mimeType: "image/jpeg",
    quality: 0.82,
  });
  assert.equal(jpg.renderCalls[0].scale, 1.25);

  const png = stubDeps();
  await buildImageArchive(makePages(1), "png", png.deps);
  assert.deepEqual(png.encodeCalls[0], {
    canvas: "canvas:p1",
    mimeType: "image/png",
    quality: undefined,
  });
  assert.equal(png.renderCalls[0].scale, 1.5);
});

test("keeps names sortable past the hundredth page", () => {
  assert.equal(imageEntryName(0, "jpg"), "page-001.jpg");
  assert.equal(imageEntryName(99, "png"), "page-100.png");
});

test("holds PNG conversion to its page limit", async () => {
  const stub = stubDeps();
  await assert.rejects(
    () => buildImageArchive(makePages(MAX_PNG_PAGES + 1), "png", stub.deps),
    new RegExp(`จำกัด ${MAX_PNG_PAGES} หน้า`),
  );
  assert.equal(stub.renderCalls.length, 0, "must refuse before doing any work");

  const atLimit = stubDeps();
  const { entryCount } = await buildImageArchive(makePages(MAX_PNG_PAGES), "png", atLimit.deps);
  assert.equal(entryCount, MAX_PNG_PAGES);
});

test("refuses to ship a page that encoded to nothing", async () => {
  const stub = stubDeps({ encodeBytes: (index) => (index === 1 ? new Uint8Array(0) : ONE_PIXEL_JPEG) });
  await assert.rejects(
    () => buildImageArchive(makePages(3), "jpg", stub.deps),
    /สร้างภาพของหน้า 2 ไม่สำเร็จ/,
  );
});

test("refuses a page encoded in the wrong format", async () => {
  const stub = stubDeps({ encodeBytes: () => ONE_PIXEL_PNG });
  await assert.rejects(
    () => buildImageArchive(makePages(1), "jpg", stub.deps),
    /สร้างภาพของหน้า 1 ไม่สำเร็จ/,
  );
});

test("reports progress per page and hands control back while working", async () => {
  const stub = stubDeps();
  await buildImageArchive(makePages(7), "jpg", stub.deps);

  const perPage = stub.progress.filter((entry) => entry.label.startsWith("กำลังแปลงหน้า"));
  assert.equal(perPage.length, 7);
  assert.equal(perPage[0].label, "กำลังแปลงหน้า 1 จาก 7");
  assert.ok(perPage.at(-1).percent >= perPage[0].percent, "progress must not go backwards");
  assert.ok(stub.progress.some((entry) => entry.label.includes("ZIP")), "zipping is reported too");
  assert.ok(stub.yieldCount() > 0, "must yield so the tab can paint");
});

test("refuses an empty document", async () => {
  const stub = stubDeps();
  await assert.rejects(() => buildImageArchive([], "jpg", stub.deps), /อย่างน้อย 1 หน้า/);
});

// --------------------------------------------------------------- compress --

test("compresses to a real PDF with one page per workspace page", async () => {
  const stub = stubDeps();
  const bytes = await buildCompressedPdf(makePages(3), "balanced", stub.deps);

  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 3);
  const { width, height } = document.getPage(0).getSize();
  assert.ok(Math.abs(width - A4_BOX.pageWidth) < 0.01, `expected A4 width, got ${width}`);
  assert.ok(Math.abs(height - A4_BOX.pageHeight) < 0.01, `expected A4 height, got ${height}`);
});

test("renders and encodes at the chosen compression level", async () => {
  for (const level of Object.keys(COMPRESSION_SETTINGS)) {
    const stub = stubDeps();
    await buildCompressedPdf(makePages(1), level, stub.deps);
    assert.equal(stub.renderCalls[0].scale, COMPRESSION_SETTINGS[level].scale, level);
    assert.equal(stub.encodeCalls[0].quality, COMPRESSION_SETTINGS[level].quality, level);
    assert.equal(stub.encodeCalls[0].mimeType, "image/jpeg", level);
  }
});

test("never emits a compressed document with no pages", async () => {
  const stub = stubDeps();
  await assert.rejects(() => buildCompressedPdf([], "balanced", stub.deps), /อย่างน้อย 1 หน้า/);
});

// ------------------------------------------------------- compression note --

test("reports the saving when the whole upload was compressed", () => {
  const note = compressionNote({
    inputBytes: 10 * 1024 * 1024,
    outputBytes: 2 * 1024 * 1024,
    pageCount: 12,
    comparableToInput: true,
  });
  assert.match(note, /ลดลง 80%/);
  assert.match(note, /10\.0 MB/, "says what it is comparing against");
  assert.match(note, /ตรวจครบ 12 หน้า/);
});

test("claims no saving once pages have been deleted", () => {
  // The old note divided by the size of every uploaded file, so deleting pages
  // inflated the percentage with bytes the compression never touched.
  const note = compressionNote({
    inputBytes: 10 * 1024 * 1024,
    outputBytes: 2 * 1024 * 1024,
    pageCount: 3,
    comparableToInput: false,
  });
  assert.doesNotMatch(note, /%/, "no percentage when the comparison is invalid");
  assert.match(note, /ลบหน้าออก/);
  assert.match(note, /ตรวจครบ 3 หน้า/);
});

test("says so plainly when the file did not get smaller", () => {
  const note = compressionNote({
    inputBytes: 1000,
    outputBytes: 1200,
    pageCount: 1,
    comparableToInput: true,
  });
  assert.match(note, /ไม่เล็กลง/);
  assert.doesNotMatch(note, /ลดลง/);
});

test("never rounds a real saving down to nothing, and never divides by zero", () => {
  assert.match(
    compressionNote({ inputBytes: 100000, outputBytes: 99999, pageCount: 1, comparableToInput: true }),
    /ลดลง 1%/,
  );
  assert.doesNotMatch(
    compressionNote({ inputBytes: 0, outputBytes: 0, pageCount: 1, comparableToInput: true }),
    /%|NaN|Infinity/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { PDFArray, PDFDocument, decodePDFRawStream } from "pdf-lib";
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
  stripJpegMetadata,
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

// A real 3x2 baseline JPEG (macOS sips) with its metadata removed; tests add their own EXIF.
const CLEAN_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QA" +
  "tRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6" +
  "Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJ" +
  "ytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQD" +
  "BAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK" +
  "U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX" +
  "2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBAMDAwQFBAQEBAUHBQUFBQUHCAcHBwcHBwgICAgICAgICgoKCgoK" +
  "CwsLCwsNDQ0NDQ0NDQ0N/9sAQwECAgIDAwMGAwMGDQkHCQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N" +
  "DQ0NDQ0NDQ0N/90ABAAB/9oADAMBAAIRAxEAPwD8x/jR/wAj/P8A9g3Rf/TZa15XXqnxo/5H+f8A7Bui/wDpsta8rr/Z36Pf/JrO" +
  "Gv8AsAwn/qPTPzvNf99rf4pfmz//2Q==",
  "base64",
);

/** The JPEG with an APP1 EXIF segment after SOI, as a phone writes it: device name plus orientation. */
function withExif(jpeg, orientation) {
  const make = Buffer.from("SECRET-PHONE\0", "latin1");
  const ifd = Buffer.alloc(2 + 2 * 12 + 4);
  ifd.writeUInt16BE(2, 0);
  ifd.writeUInt16BE(0x010f, 2); // Make, ASCII, stored after the IFD
  ifd.writeUInt16BE(2, 4);
  ifd.writeUInt32BE(make.length, 6);
  ifd.writeUInt32BE(8 + ifd.length, 10);
  ifd.writeUInt16BE(0x0112, 14); // Orientation, SHORT
  ifd.writeUInt16BE(3, 16);
  ifd.writeUInt32BE(1, 18);
  ifd.writeUInt16BE(orientation, 22);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]), ifd, make]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

function jpgSource(buffer) {
  return {
    id: "photo",
    name: "photo.jpg",
    type: "jpg",
    bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    size: buffer.byteLength,
    pageCount: 1,
  };
}

async function buildPhotoPage(buffer, rotation = 0) {
  const output = await buildPdf([jpgSource(buffer)], [{ id: "p1", sourceId: "photo", pageNumber: 1, rotation }]);
  return { output, page: (await PDFDocument.load(output)).getPage(0) };
}

function pageOperators(page) {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.doc.context.lookup(ref)) : [contents];
  return streams.map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
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

test("strips EXIF from a JPEG and keeps the image bytes", () => {
  const photo = withExif(CLEAN_JPEG, 6);
  assert.ok(photo.includes("SECRET-PHONE"));
  const stripped = stripJpegMetadata(new Uint8Array(photo), "photo.jpg");
  assert.equal(stripped.orientation, 6);
  assert.deepEqual(Buffer.from(stripped.bytes), CLEAN_JPEG);
});

test("builds a photo PDF without the photo's EXIF, on the same page", async () => {
  const { output, page } = await buildPhotoPage(withExif(CLEAN_JPEG, 1));
  const pdf = Buffer.from(output);
  assert.ok(!pdf.includes("SECRET-PHONE"));
  assert.ok(!pdf.includes("Exif"));
  assert.equal((await PDFDocument.load(output)).getPageCount(), 1);
  const plain = await buildPhotoPage(CLEAN_JPEG);
  assert.deepEqual(page.getSize(), plain.page.getSize());
  assert.deepEqual(page.getSize(), { width: A4_LONG_EDGE, height: A4_SHORT_EDGE });
  assert.equal(page.getRotation().angle, 0);
});

test("turns the page the way the EXIF orientation showed the photo", async () => {
  assert.equal((await buildPhotoPage(withExif(CLEAN_JPEG, 6))).page.getRotation().angle, 90);
  assert.equal((await buildPhotoPage(withExif(CLEAN_JPEG, 8), 90)).page.getRotation().angle, 0);
  assert.equal((await buildPhotoPage(withExif(CLEAN_JPEG, 3))).page.getRotation().angle, 180);
});

test("mirrors a photo whose EXIF orientation is mirrored", async () => {
  const mirrored = await buildPhotoPage(withExif(CLEAN_JPEG, 2));
  assert.match(pageOperators(mirrored.page), /^-[\d.]+ 0 0 [\d.]+ 0 0 cm$/m);
  assert.doesNotMatch(pageOperators((await buildPhotoPage(CLEAN_JPEG)).page), /^-[\d.]+ 0 0/m);
});

test("refuses a damaged JPEG with a Thai message", () => {
  assert.throws(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00]), "broken.jpg"), /อ่านรูป “broken.jpg” ไม่ได้/);
  assert.throws(() => stripJpegMetadata(new Uint8Array([0x89, 0x50]), "fake.jpg"), /ไม่ใช่ JPG/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, degrees } from "pdf-lib";
import {
  addPageNumbers,
  nUp,
  numberAnchor,
  originForCentre,
  pageNumberText,
  readMetadata,
  readPageSizes,
  replaceWithImages,
  resizeToA4,
  rotatedOrigin,
  sheetCount,
  stampFrame,
  stampImage,
  stripMetadata,
  toUserSpace,
  visualSize,
} from "../app/lib/pdf-tools.ts";

const A4 = [595.28, 841.89];
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.01, `${label}: ${actual} ≠ ${expected}`);

// 1×1 transparent PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

async function makePdf(specs, configure) {
  const document = await PDFDocument.create();
  for (const { size = A4, rotation = 0 } of specs) {
    const page = document.addPage(size);
    page.setRotation(degrees(rotation));
  }
  configure?.(document);
  return document.save();
}

// ------------------------------------------------------------- geometry --

test("displayed corners map onto the page's own corners for every rotation", () => {
  const box = { x: 10, y: 20, width: 200, height: 300 };
  for (const rotation of [0, 90, 180, 270]) {
    const visual = visualSize(box, rotation);
    const corners = [
      toUserSpace(box, rotation, { x: 0, y: 0 }),
      toUserSpace(box, rotation, { x: visual.width, y: visual.height }),
    ];
    for (const corner of corners) {
      assert.ok([10, 210].includes(Math.round(corner.x)), `x ${corner.x} at ${rotation}°`);
      assert.ok([20, 320].includes(Math.round(corner.y)), `y ${corner.y} at ${rotation}°`);
    }
  }
});

test("a quarter turn sends the displayed bottom-left to the page's bottom-right", () => {
  // Clockwise /Rotate 90: the page's right edge becomes the displayed bottom.
  const at = toUserSpace({ x: 0, y: 0, width: 200, height: 300 }, 90, { x: 0, y: 0 });
  assert.deepEqual(at, { x: 200, y: 0 });
});

test("a rotated stamp is centred where it was asked to be", () => {
  const origin = originForCentre({ x: 100, y: 100 }, 40, 20, 30);
  const radians = (30 * Math.PI) / 180;
  const centre = {
    x: origin.x + Math.cos(radians) * 20 - Math.sin(radians) * 10,
    y: origin.y + Math.sin(radians) * 20 + Math.cos(radians) * 10,
  };
  near(centre.x, 100, "x");
  near(centre.y, 100, "y");
});

test("a page drawn into a slot fills it for every rotation", () => {
  const target = { x: 50, y: 60, width: 300, height: 200 };
  // scaled unrotated size w×h; when rotated 90/270 it covers h×w.
  for (const [rotation, w, h] of [[0, 300, 200], [90, 200, 300], [180, 300, 200], [270, 200, 300]]) {
    const origin = rotatedOrigin(target, w, h, rotation);
    const radians = (-rotation * Math.PI) / 180;
    const xs = [];
    const ys = [];
    for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      xs.push(origin.x + px * Math.cos(radians) - py * Math.sin(radians));
      ys.push(origin.y + px * Math.sin(radians) + py * Math.cos(radians));
    }
    near(Math.min(...xs), 50, `left at ${rotation}°`);
    near(Math.min(...ys), 60, `bottom at ${rotation}°`);
    near(Math.max(...xs), 350, `right at ${rotation}°`);
    near(Math.max(...ys), 260, `top at ${rotation}°`);
  }
});

test("page numbers sit inside the page, bottom centre or right", () => {
  const visual = { width: 595, height: 842 };
  const centre = numberAnchor(visual, 20, 10, "bottom-center");
  near(centre.x + 10, 297.5, "centred");
  assert.ok(centre.y > 0 && centre.y < 60);
  const top = numberAnchor(visual, 20, 10, "top-right");
  assert.ok(top.y > 780 && top.x + 20 < 595);
  assert.equal(pageNumberText(2, 9, "plain"), "3");
  assert.equal(pageNumberText(2, 9, "of-total"), "3 / 9");
});

test("a diagonal watermark is centred on the page and follows its diagonal", () => {
  const frame = stampFrame({ width: 600, height: 800 }, { width: 400, height: 100 }, { kind: "diagonal", widthRatio: 0.6 });
  near(frame.angle, (Math.atan2(800, 600) * 180) / Math.PI, "angle");
  near(frame.height / frame.width, 0.25, "keeps the image's proportions");
});

test("a corner stamp stays on the page", () => {
  const frame = stampFrame({ width: 600, height: 800 }, { width: 300, height: 100 }, { kind: "corner", corner: "bottom-right", widthRatio: 0.3 });
  assert.ok(frame.origin.x > 0 && frame.origin.x + frame.width < 600);
  assert.ok(frame.origin.y > 0);
});

// ---------------------------------------------------------- whole documents --

test("page numbers keep every page and its size, rotated pages included", async () => {
  const input = await makePdf([{}, { rotation: 90 }, { size: [842, 595] }]);
  const output = await addPageNumbers(input, { position: "bottom-center", format: "of-total" });
  const sizes = await readPageSizes(output);
  assert.equal(sizes.length, 3);
  assert.deepEqual(sizes, await readPageSizes(input));
});

test("a stamp lands only on the chosen page", async () => {
  const input = await makePdf([{}, {}, {}]);
  const output = await stampImage(input, { bytes: PNG, width: 1, height: 1 }, { kind: "corner", corner: "bottom-right", widthRatio: 0.2 }, { opacity: 1, pageIndexes: [2] });
  const document = await PDFDocument.load(output);
  const xObjects = document.getPages().map((page) => page.node.Resources()?.lookup(PDFName.of("XObject")));
  assert.equal(xObjects[0], undefined);
  assert.equal(xObjects[1], undefined);
  assert.ok(xObjects[2] instanceof PDFDict);
});

test("asking for a page that does not exist fails rather than skipping it", async () => {
  const input = await makePdf([{}]);
  await assert.rejects(
    stampImage(input, { bytes: PNG, width: 1, height: 1 }, { kind: "diagonal", widthRatio: 0.5 }, { opacity: 0.3, pageIndexes: [4] }),
    /ไม่พบหน้า 5/,
  );
});

test("A4 resizing makes every page A4 in its own orientation", async () => {
  const input = await makePdf([{ size: [612, 792] }, { size: [1000, 500] }, { size: [300, 300], rotation: 90 }], (document) => {
    document.getPages().forEach((page) => page.drawText("x"));
  });
  const sizes = await readPageSizes(await resizeToA4(input));
  assert.equal(sizes.length, 3);
  near(sizes[0].width, A4[0], "letter → A4 portrait");
  near(sizes[1].width, A4[1], "wide → A4 landscape");
  near(sizes[2].height, A4[1], "square stays portrait");
});

test("a blank page with no content stream is laid out as a blank space, not an error", async () => {
  const document = await PDFDocument.create();
  document.addPage(A4);
  document.addPage(A4).drawText("x");
  const input = await document.save();
  assert.equal((await readPageSizes(await nUp(input, 2))).length, 1);
  assert.equal((await readPageSizes(await resizeToA4(input))).length, 2);
});

test("two or four pages per sheet produce the right number of sheets", async () => {
  const input = await makePdf([{}, {}, {}, {}, { rotation: 270 }], (document) => {
    document.getPages().forEach((page, index) => page.drawText(`page ${index + 1}`));
  });
  assert.equal((await readPageSizes(await nUp(input, 2))).length, sheetCount(5, 2));
  assert.equal((await readPageSizes(await nUp(input, 4))).length, sheetCount(5, 4));
  assert.equal(sheetCount(5, 4), 2);
  const [first] = await readPageSizes(await nUp(input, 2));
  assert.ok(first.width > first.height, "two-up is printed landscape");
});

test("metadata is listed in plain Thai, and stripping removes all of it", async () => {
  const input = await makePdf([{}, {}], (document) => {
    document.setTitle("สัญญาเช่า");
    document.setAuthor("สมชาย ใจดี");
    document.setCreator("Microsoft Word");
    const xmp = document.context.flateStream("<x:xmpmeta>สมชาย</x:xmpmeta>", { Type: "Metadata", Subtype: "XML" });
    document.catalog.set(PDFName.of("Metadata"), document.context.register(xmp));
  });
  const before = await readMetadata(input);
  assert.ok(before.some((entry) => entry.label === "ผู้เขียน" && entry.value === "สมชาย ใจดี"));
  assert.ok(before.some((entry) => entry.label.startsWith("ข้อมูล XMP")));

  const output = await stripMetadata(input);
  assert.deepEqual(await readMetadata(output), []);
  // updateMetadata: false, or loading would write a fresh Producer of its own.
  const document = await PDFDocument.load(output, { updateMetadata: false });
  assert.equal(document.getPageCount(), 2);
  const leftovers = document.context
    .enumerateIndirectObjects()
    .filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Type"))?.toString() === "/Metadata");
  assert.equal(leftovers.length, 0, "no metadata stream is written, linked or not");
  assert.equal(document.context.trailerInfo.Info, undefined);
});

test("a redacted page becomes a picture; the others are copied untouched", async () => {
  const input = await makePdf([{}, {}, {}], (document) => {
    document.getPages()[1].drawText("ID 1-2345-67890-12-3");
  });
  const output = await replaceWithImages(input, [
    { index: 1, png: PNG, pageWidth: A4[0], pageHeight: A4[1], draw: { x: 0, y: 0, width: A4[0], height: A4[1] } },
  ]);
  const document = await PDFDocument.load(output);
  assert.equal(document.getPageCount(), 3);
  const redacted = document.getPages()[1];
  const xObjects = redacted.node.Resources()?.lookup(PDFName.of("XObject"));
  assert.ok(xObjects instanceof PDFDict, "the page is now an image");
  const fonts = redacted.node.Resources()?.lookup(PDFName.of("Font"));
  assert.ok(fonts === undefined || (fonts instanceof PDFDict && fonts.keys().length === 0), "and has no text left");
});

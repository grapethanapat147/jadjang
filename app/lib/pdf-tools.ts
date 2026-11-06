import type { PDFDocument as PDFDocumentType, PDFPage } from "pdf-lib";
import { A4_LONG_EDGE, A4_SHORT_EDGE } from "./pdf-engine.ts";

/**
 * Operations that run on a finished PDF — the one buildPdf makes from the
 * workspace, so page order, deletions and rotation are already applied.
 *
 * Everything here is placed in what the reader SEES. A page carrying /Rotate
 * is drawn in its own unrotated space, so "bottom right" has to be translated
 * through that rotation or the stamp lands on the side of the page.
 */

export type Rotation = 0 | 90 | 180 | 270;
export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

export function normalizeRotation(angle: number): Rotation {
  const turned = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return turned as Rotation;
}

/** Size of the page as displayed. */
export function visualSize(box: Box, rotation: Rotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/**
 * A point measured from the displayed page's bottom-left, in the page's own
 * coordinate space. Anything drawn there must also be rotated by `rotation`
 * (counter-clockwise, as pdf-lib counts) to read upright.
 */
export function toUserSpace(box: Box, rotation: Rotation, point: Point): Point {
  const { x, y, width, height } = box;
  switch (rotation) {
    case 90:
      return { x: x + width - point.y, y: y + point.x };
    case 180:
      return { x: x + width - point.x, y: y + height - point.y };
    case 270:
      return { x: x + point.y, y: y + height - point.x };
    default:
      return { x: x + point.x, y: y + point.y };
  }
}

/** Origin of something w×h rotated by `angle` degrees so its centre lands on `centre`. */
export function originForCentre(centre: Point, width: number, height: number, angle: number): Point {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: centre.x - (cos * width) / 2 + (sin * height) / 2,
    y: centre.y - (sin * width) / 2 - (cos * height) / 2,
  };
}

function pageGeometry(page: PDFPage) {
  const crop = page.getCropBox();
  const box = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
  const rotation = normalizeRotation(page.getRotation().angle);
  return { box, rotation, visual: visualSize(box, rotation) };
}

async function loadForEditing(bytes: Uint8Array) {
  const { PDFDocument } = await import("pdf-lib");
  return PDFDocument.load(bytes, { updateMetadata: false });
}

function save(document: PDFDocumentType) {
  return document.save({ useObjectStreams: true, addDefaultPage: false });
}

// ------------------------------------------------------------ page numbers --

export type NumberPosition = "bottom-center" | "bottom-right" | "top-right";
export type NumberFormat = "plain" | "of-total";

export function pageNumberText(index: number, total: number, format: NumberFormat): string {
  return format === "of-total" ? `${index + 1} / ${total}` : String(index + 1);
}

/** Bottom-left of the label in displayed coordinates. */
export function numberAnchor(
  visual: { width: number; height: number },
  textWidth: number,
  fontSize: number,
  position: NumberPosition,
): Point {
  const margin = Math.max(18, Math.min(visual.width, visual.height) * 0.04);
  const x =
    position === "bottom-center" ? (visual.width - textWidth) / 2 : visual.width - margin - textWidth;
  const y = position === "top-right" ? visual.height - margin - fontSize : margin;
  return { x, y };
}

export async function addPageNumbers(
  bytes: Uint8Array,
  options: { position: NumberPosition; format: NumberFormat },
): Promise<Uint8Array> {
  const { StandardFonts, rgb, degrees } = await import("pdf-lib");
  const document = await loadForEditing(bytes);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = document.getPages();

  pages.forEach((page, index) => {
    const { box, rotation, visual } = pageGeometry(page);
    const fontSize = Math.max(9, Math.min(14, Math.min(visual.width, visual.height) / 50));
    const text = pageNumberText(index, pages.length, options.format);
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const at = toUserSpace(box, rotation, numberAnchor(visual, textWidth, fontSize, options.position));
    page.drawText(text, { x: at.x, y: at.y, size: fontSize, font, color: rgb(0.2, 0.22, 0.27), rotate: degrees(rotation) });
  });

  return save(document);
}

// ------------------------------------------------------- stamps: watermark, sign --

export type StampPlacement =
  | { kind: "diagonal"; widthRatio: number }
  | { kind: "corner"; corner: "bottom-left" | "bottom-center" | "bottom-right"; widthRatio: number };

export type StampImage = { bytes: Uint8Array; width: number; height: number };

/** Where a stamp goes in displayed coordinates, and the angle it is drawn at. */
export function stampFrame(
  visual: { width: number; height: number },
  image: { width: number; height: number },
  placement: StampPlacement,
): { origin: Point; width: number; height: number; angle: number } {
  const aspect = image.height / Math.max(1, image.width);
  if (placement.kind === "diagonal") {
    const angle = (Math.atan2(visual.height, visual.width) * 180) / Math.PI;
    const diagonal = Math.hypot(visual.width, visual.height);
    const width = diagonal * placement.widthRatio;
    const height = width * aspect;
    const origin = originForCentre({ x: visual.width / 2, y: visual.height / 2 }, width, height, angle);
    return { origin, width, height, angle };
  }
  const margin = Math.max(18, Math.min(visual.width, visual.height) * 0.05);
  const width = visual.width * placement.widthRatio;
  const height = width * aspect;
  const x =
    placement.corner === "bottom-left"
      ? margin
      : placement.corner === "bottom-center"
        ? (visual.width - width) / 2
        : visual.width - margin - width;
  return { origin: { x, y: margin }, width, height, angle: 0 };
}

/**
 * Draws one PNG on the chosen pages. `pageIndexes` empty means every page.
 * Used for both the watermark and the signature: either is an image by the
 * time it gets here, which is how Thai text survives — the browser shapes it
 * on a canvas, where pdf-lib's standard fonts could not.
 */
export async function stampImage(
  bytes: Uint8Array,
  image: StampImage,
  placement: StampPlacement,
  options: { opacity: number; pageIndexes?: number[] },
): Promise<Uint8Array> {
  const { degrees } = await import("pdf-lib");
  const document = await loadForEditing(bytes);
  const embedded = await document.embedPng(image.bytes);
  const pages = document.getPages();
  const targets = options.pageIndexes?.length ? options.pageIndexes : pages.map((_, index) => index);

  for (const index of targets) {
    const page = pages[index];
    if (!page) throw new Error(`ไม่พบหน้า ${index + 1} ในเอกสาร`);
    const { box, rotation, visual } = pageGeometry(page);
    const frame = stampFrame(visual, image, placement);
    const at = toUserSpace(box, rotation, frame.origin);
    page.drawImage(embedded, {
      x: at.x,
      y: at.y,
      width: frame.width,
      height: frame.height,
      rotate: degrees(frame.angle + rotation),
      opacity: options.opacity,
    });
  }

  return save(document);
}

// ------------------------------------------------------------ layout: A4, n-up --

/** Where the embedded (unrotated) page's origin goes so the rotated drawing fills `target`. */
export function rotatedOrigin(target: Box, scaledWidth: number, scaledHeight: number, rotation: Rotation): Point {
  switch (rotation) {
    case 90:
      return { x: target.x, y: target.y + scaledWidth };
    case 180:
      return { x: target.x + scaledWidth, y: target.y + scaledHeight };
    case 270:
      return { x: target.x + scaledHeight, y: target.y };
    default:
      return { x: target.x, y: target.y };
  }
}

/** Largest scale that fits `visual` inside `slot`, centred. */
export function fitInto(visual: { width: number; height: number }, slot: Box): { scale: number; box: Box } {
  const scale = Math.min(slot.width / visual.width, slot.height / visual.height);
  const width = visual.width * scale;
  const height = visual.height * scale;
  return {
    scale,
    box: { x: slot.x + (slot.width - width) / 2, y: slot.y + (slot.height - height) / 2, width, height },
  };
}

export function a4For(visual: { width: number; height: number }): { width: number; height: number } {
  return visual.width > visual.height
    ? { width: A4_LONG_EDGE, height: A4_SHORT_EDGE }
    : { width: A4_SHORT_EDGE, height: A4_LONG_EDGE };
}

/** Slots on an A4 sheet for 2 or 4 pages, in reading order (top-left first). */
export function sheetSlots(perSheet: 2 | 4): { sheet: { width: number; height: number }; slots: Box[] } {
  const gutter = 14;
  if (perSheet === 2) {
    const sheet = { width: A4_LONG_EDGE, height: A4_SHORT_EDGE };
    const width = (sheet.width - gutter * 3) / 2;
    const height = sheet.height - gutter * 2;
    return { sheet, slots: [0, 1].map((column) => ({ x: gutter + column * (width + gutter), y: gutter, width, height })) };
  }
  const sheet = { width: A4_SHORT_EDGE, height: A4_LONG_EDGE };
  const width = (sheet.width - gutter * 3) / 2;
  const height = (sheet.height - gutter * 3) / 2;
  const slots: Box[] = [];
  for (const row of [1, 0]) {
    for (const column of [0, 1]) {
      slots.push({ x: gutter + column * (width + gutter), y: gutter + row * (height + gutter), width, height });
    }
  }
  return { sheet, slots };
}

type Sheet = { sheet: { width: number; height: number }; slots: Array<{ index: number; slot: Box }> };

async function placePages(
  bytes: Uint8Array,
  layout: (visuals: Array<{ width: number; height: number }>) => Sheet[],
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import("pdf-lib");
  const source = await loadForEditing(bytes);
  const output = await PDFDocument.create();
  const sourcePages = source.getPages();
  const geometry = sourcePages.map(pageGeometry);

  for (const sheet of layout(geometry.map((entry) => entry.visual))) {
    const outputPage = output.addPage([sheet.sheet.width, sheet.sheet.height]);
    for (const { index, slot } of sheet.slots) {
      // A page with nothing drawn on it has no content stream to embed; its
      // slot stays blank, which is what it looked like.
      if (!sourcePages[index].node.Contents()) continue;
      const { box, rotation, visual } = geometry[index];
      const embedded = await output.embedPage(sourcePages[index], {
        left: box.x,
        bottom: box.y,
        right: box.x + box.width,
        top: box.y + box.height,
      });
      const { scale, box: target } = fitInto(visual, slot);
      const origin = rotatedOrigin(target, box.width * scale, box.height * scale, rotation);
      outputPage.drawPage(embedded, {
        x: origin.x,
        y: origin.y,
        xScale: scale,
        yScale: scale,
        rotate: degrees(-rotation),
      });
    }
  }

  return save(output);
}

/** Every page onto A4 in its own orientation, scaled to fit with a small margin. */
export function resizeToA4(bytes: Uint8Array): Promise<Uint8Array> {
  const margin = 18;
  return placePages(bytes, (visuals) =>
    visuals.map((visual, index) => {
      const sheet = a4For(visual);
      return {
        sheet,
        slots: [{ index, slot: { x: margin, y: margin, width: sheet.width - margin * 2, height: sheet.height - margin * 2 } }],
      };
    }),
  );
}

export function sheetCount(pageCount: number, perSheet: 2 | 4): number {
  return Math.ceil(pageCount / perSheet);
}

export function nUp(bytes: Uint8Array, perSheet: 2 | 4): Promise<Uint8Array> {
  const { sheet, slots } = sheetSlots(perSheet);
  return placePages(bytes, (visuals) =>
    Array.from({ length: sheetCount(visuals.length, perSheet) }, (_, sheetIndex) => ({
      sheet,
      slots: slots
        .map((slot, slotIndex) => ({ index: sheetIndex * perSheet + slotIndex, slot }))
        .filter((entry) => entry.index < visuals.length),
    })),
  );
}

/** Every page's displayed size, for checking a result. */
export async function readPageSizes(bytes: Uint8Array): Promise<Array<{ width: number; height: number }>> {
  const document = await loadForEditing(bytes);
  return document.getPages().map((page) => pageGeometry(page).visual);
}

// ------------------------------------------------------------- privacy --

export type MetadataEntry = { label: string; value: string };

const XMP_NOTE = "ข้อมูล XMP (รายละเอียดที่โปรแกรมแต่งเอกสารฝังไว้)";

function formatDate(date: Date | undefined): string | undefined {
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
}

/** What a PDF says about itself, in words a non-technical reader can check. */
export async function readMetadata(bytes: ArrayBuffer | Uint8Array): Promise<MetadataEntry[]> {
  const { PDFDocument, PDFName } = await import("pdf-lib");
  const document = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const entries: Array<[string, string | undefined]> = [
    ["ชื่อเรื่อง", document.getTitle()],
    ["ผู้เขียน", document.getAuthor()],
    ["หัวเรื่อง", document.getSubject()],
    ["คำสำคัญ", document.getKeywords()],
    ["โปรแกรมที่สร้าง", document.getCreator()],
    ["โปรแกรมที่แปลงเป็น PDF", document.getProducer()],
    ["วันที่สร้าง", formatDate(document.getCreationDate())],
    ["วันที่แก้ไขล่าสุด", formatDate(document.getModificationDate())],
  ];
  const found = entries
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
    .map(([label, value]) => ({ label, value: value.trim() }));
  if (document.catalog.has(PDFName.of("Metadata"))) found.push({ label: XMP_NOTE, value: "มี" });
  return found;
}

/**
 * Drops the document information dictionary, the XMP stream, and the per-page
 * metadata and application data that editors leave behind.
 *
 * Copied into a fresh document rather than edited in place: deleting a key
 * only unlinks its object, and pdf-lib still writes every object it holds —
 * the author's name would ride along, just unreferenced.
 */
export async function stripMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument, PDFName } = await import("pdf-lib");
  const source = await loadForEditing(bytes);
  for (const page of source.getPages()) {
    page.node.delete(PDFName.of("Metadata"));
    page.node.delete(PDFName.of("PieceInfo"));
  }
  const output = await PDFDocument.create({ updateMetadata: false });
  const copied = await output.copyPages(source, source.getPageIndices());
  copied.forEach((page) => output.addPage(page));
  return save(output);
}

export type RasterPage = { index: number; png: Uint8Array; pageWidth: number; pageHeight: number; draw: Box };

/**
 * Swaps the listed pages for flat images of themselves. A box drawn over text
 * leaves the text underneath, selectable and searchable; replacing the page
 * with a picture is what actually removes it.
 */
export async function replaceWithImages(bytes: Uint8Array, rasters: RasterPage[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const source = await loadForEditing(bytes);
  const output = await PDFDocument.create();
  const byIndex = new Map(rasters.map((raster) => [raster.index, raster]));

  for (let index = 0; index < source.getPageCount(); index += 1) {
    const raster = byIndex.get(index);
    if (!raster) {
      const [copied] = await output.copyPages(source, [index]);
      output.addPage(copied);
      continue;
    }
    const image = await output.embedPng(raster.png);
    const page = output.addPage([raster.pageWidth, raster.pageHeight]);
    page.drawImage(image, { x: raster.draw.x, y: raster.draw.y, width: raster.draw.width, height: raster.draw.height });
  }

  return save(output);
}

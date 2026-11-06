import type { PDFDocument as PDFDocumentType, Rotation } from "pdf-lib";

export const MAX_FILES = 24;
export const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
export const MAX_SINGLE_BYTES = 120 * 1024 * 1024;
export const MAX_PAGES = 250;

export const A4_SHORT_EDGE = 595.28;
export const A4_LONG_EDGE = 841.89;
export const IMAGE_PAGE_MARGIN = 24;

export type SourceRecord = {
  id: string;
  name: string;
  type: "pdf" | "jpg" | "png";
  bytes: ArrayBuffer;
  size: number;
  /** Pages this file contributed when it was read. Images contribute one. */
  pageCount: number;
};

export type SplitSelection = {
  page: PageRecord;
  /** 1-based position in the workspace, so file names match what the user saw. */
  position: number;
};

export type PageRecord = {
  id: string;
  sourceId: string;
  pageNumber: number;
  rotation: number;
};

export type UploadCandidate = Pick<File, "name" | "size" | "type">;
type PdfDocumentFactory = {
  load(
    bytes: ArrayBuffer,
    options: { ignoreEncryption: boolean; updateMetadata: boolean },
  ): Promise<PDFDocumentType>;
};

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function validateInputFiles(files: UploadCandidate[]) {
  if (!files.length) return "ยังไม่ได้เลือกไฟล์";
  if (files.length > MAX_FILES) return `เลือกได้ไม่เกิน ${MAX_FILES} ไฟล์ต่อครั้ง`;

  const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
  const invalid = files.find((file) => {
    const extension = file.name.toLowerCase().split(".").pop();
    return !allowed.has(file.type) && !["pdf", "jpg", "jpeg", "png"].includes(extension ?? "");
  });
  if (invalid) return `ไฟล์ “${invalid.name}” ยังไม่รองรับ กรุณาใช้ PDF, JPG หรือ PNG`;

  const oversized = files.find((file) => file.size > MAX_SINGLE_BYTES);
  if (oversized) return `ไฟล์ “${oversized.name}” ใหญ่เกิน 120 MB`;

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) return "ขนาดไฟล์รวมเกิน 150 MB กรุณาแบ่งทำเป็นหลายรอบ";
  return null;
}

/**
 * Source ids that no page refers to any more, so their bytes and cached
 * documents can be released instead of sitting in memory for the whole session.
 */
export function findOrphanedSourceIds(
  sourceIds: string[],
  pages: Array<Pick<PageRecord, "sourceId">>,
): string[] {
  const stillUsed = new Set(pages.map((page) => page.sourceId));
  return sourceIds.filter((id) => !stillUsed.has(id));
}

/**
 * Whether the workspace still holds every page of every file it read.
 *
 * Once pages have been deleted, comparing an output against the original file
 * sizes measures the deletion as much as the compression.
 */
export function hasEveryPage(
  sources: Array<Pick<SourceRecord, "id" | "pageCount">>,
  pages: Array<Pick<PageRecord, "sourceId">>,
): boolean {
  const present = new Map<string, number>();
  for (const page of pages) {
    present.set(page.sourceId, (present.get(page.sourceId) ?? 0) + 1);
  }
  return sources.every((source) => (present.get(source.id) ?? 0) === source.pageCount);
}

/** Zero-padded so the archive sorts correctly however many pages it holds. */
export function splitEntryName(position: number, highestPosition: number): string {
  const width = Math.max(2, String(Math.max(1, highestPosition)).length);
  return `page-${String(position).padStart(width, "0")}.pdf`;
}

export async function verifyPdfPageCount(bytes: Uint8Array, expectedPages: number): Promise<void> {
  const { PDFDocument } = await import("pdf-lib");
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const actualPages = document.getPageCount();
  if (actualPages !== expectedPages) {
    throw new Error(
      `ผลลัพธ์มี ${actualPages} หน้า แต่ควรมี ${expectedPages} หน้า ระบบจึงหยุดดาวน์โหลดเพื่อความปลอดภัย`,
    );
  }
}

export function movePage<T>(items: T[], from: number, to: number) {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export type PageBox = {
  pageWidth: number;
  pageHeight: number;
  drawWidth: number;
  drawHeight: number;
  x: number;
  y: number;
};

export function mimeTypeForSource(type: SourceRecord["type"]): string {
  if (type === "pdf") return "application/pdf";
  if (type === "png") return "image/png";
  return "image/jpeg";
}

/**
 * Page box for raster output whose dimensions are already PDF points,
 * so the rendered page keeps the size of the page it came from.
 */
export function fillPageBox(widthInPoints: number, heightInPoints: number): PageBox {
  const pageWidth = Math.max(1, widthInPoints);
  const pageHeight = Math.max(1, heightInPoints);
  return { pageWidth, pageHeight, drawWidth: pageWidth, drawHeight: pageHeight, x: 0, y: 0 };
}

/**
 * Centers an image measured in pixels on an A4 page measured in points,
 * keeping its aspect ratio. Without this, pixel counts leak into page sizes.
 */
export function fitImageOnA4(
  imageWidth: number,
  imageHeight: number,
  margin: number = IMAGE_PAGE_MARGIN,
): PageBox {
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  const isLandscape = width > height;
  const pageWidth = isLandscape ? A4_LONG_EDGE : A4_SHORT_EDGE;
  const pageHeight = isLandscape ? A4_SHORT_EDGE : A4_LONG_EDGE;
  const scale = Math.min((pageWidth - margin * 2) / width, (pageHeight - margin * 2) / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    pageWidth,
    pageHeight,
    drawWidth,
    drawHeight,
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
  };
}

/** Clockwise turn per EXIF orientation (index 1–8) that makes a photo look as the browser shows it. */
const EXIF_TURN = [0, 0, 0, 180, 180, 270, 90, 90, 270];
/** EXIF orientations that also mirror the photo left to right before the turn. */
const EXIF_MIRRORED = new Set([2, 4, 5, 7]);

function readExifOrientation(segment: Uint8Array) {
  // "Exif\0\0", then a TIFF header; orientation is tag 0x0112 in the first IFD.
  if (segment.length < 14 || String.fromCharCode(...segment.subarray(0, 4)) !== "Exif") return 1;
  const tiff = new DataView(segment.buffer, segment.byteOffset + 6, segment.length - 6);
  const littleEndian = tiff.getUint16(0) === 0x4949;
  const ifd = tiff.getUint32(4, littleEndian);
  if (ifd + 2 > tiff.byteLength) return 1;
  for (let index = 0; index < tiff.getUint16(ifd, littleEndian); index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.byteLength) return 1;
    if (tiff.getUint16(entry, littleEndian) !== 0x0112) continue;
    const orientation = tiff.getUint16(entry + 8, littleEndian);
    return orientation >= 1 && orientation <= 8 ? orientation : 1;
  }
  return 1;
}

/**
 * Drops every APP1–APP15 segment (EXIF with GPS, device and time, XMP, ICC, IPTC…) and comments
 * from a JPEG, because pdf-lib embeds JPEG bytes as they are. APP0 (JFIF) and APP14 (Adobe, needed
 * to decode CMYK colour) stay. The orientation tag is read first so the page can still turn the
 * photo the way the browser showed it.
 */
export function stripJpegMetadata(bytes: Uint8Array, name: string) {
  const unreadable = () => new Error(`อ่านรูป “${name}” ไม่ได้ ไฟล์อาจเสียหายหรือไม่ใช่ JPG ที่สมบูรณ์`);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw unreadable();
  const kept = [bytes.subarray(0, 2)];
  let orientation = 1;
  let offset = 2;
  for (;;) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (bytes[offset + 1] === 0xff) offset += 1;
    const marker = bytes[offset + 1];
    if (marker === undefined) throw unreadable();
    // shortcut: metadata placed after the first scan (non-standard; cameras never do it) is kept as-is.
    if (marker === 0xda || marker === 0xd9) {
      kept.push(bytes.subarray(offset));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const end = offset + 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
    if (offset + 4 > bytes.length || end < offset + 4 || end > bytes.length) throw unreadable();
    if (marker === 0xe1 && orientation === 1) orientation = readExifOrientation(bytes.subarray(offset + 4, end));
    const isMetadata = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!isMetadata) kept.push(bytes.subarray(offset, end));
    offset = end;
  }

  const stripped = new Uint8Array(kept.reduce((total, part) => total + part.length, 0));
  let position = 0;
  for (const part of kept) {
    stripped.set(part, position);
    position += part.length;
  }
  return { bytes: stripped, orientation };
}

function normalizeRotation(value: number) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

async function appendPage(
  output: PDFDocumentType,
  source: SourceRecord,
  page: PageRecord,
  cache: Map<string, PDFDocumentType>,
  degrees: (angle: number) => Rotation,
  pdfDocumentFactory: PdfDocumentFactory,
) {
  if (source.type === "pdf") {
    let document = cache.get(source.id);
    if (!document) {
      document = await pdfDocumentFactory.load(source.bytes.slice(0), {
        ignoreEncryption: false,
        updateMetadata: false,
      });
      cache.set(source.id, document);
    }
    const [copied] = await output.copyPages(document, [page.pageNumber - 1]);
    copied.setRotation(degrees(normalizeRotation(copied.getRotation().angle + page.rotation)));
    output.addPage(copied);
    return;
  }

  // pdf-lib re-encodes PNG pixels (dropping its chunks) but copies JPEG bytes into the PDF.
  const jpeg = source.type === "jpg" ? stripJpegMetadata(new Uint8Array(source.bytes), source.name) : null;
  const image = jpeg ? await output.embedJpg(jpeg.bytes) : await output.embedPng(new Uint8Array(source.bytes.slice(0)));
  const orientation = jpeg?.orientation ?? 1;
  const mirrored = EXIF_MIRRORED.has(orientation);
  const box = fitImageOnA4(image.width, image.height);
  const imagePage = output.addPage([box.pageWidth, box.pageHeight]);
  imagePage.drawImage(image, {
    x: mirrored ? box.x + box.drawWidth : box.x,
    y: box.y,
    width: mirrored ? -box.drawWidth : box.drawWidth,
    height: box.drawHeight,
  });
  imagePage.setRotation(degrees(normalizeRotation(page.rotation + EXIF_TURN[orientation])));
}

export async function buildPdf(sources: SourceRecord[], pages: PageRecord[]) {
  if (!pages.length) throw new Error("เอกสารต้องมีอย่างน้อย 1 หน้า");
  const { PDFDocument, degrees } = await import("pdf-lib");
  const output = await PDFDocument.create();
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const cache = new Map<string, PDFDocumentType>();

  for (const page of pages) {
    const source = sourceMap.get(page.sourceId);
    if (!source) throw new Error("ไม่พบไฟล์ต้นฉบับของบางหน้า กรุณาเริ่มใหม่");
    await appendPage(output, source, page, cache, degrees, PDFDocument);
  }

  output.setTitle("จัดแจง — เอกสารพร้อมส่ง");
  output.setProducer("จัดแจง");
  output.setCreator("จัดแจง");
  output.setCreationDate(new Date());
  return output.save({ useObjectStreams: true, addDefaultPage: false });
}

export async function splitPdfPages(sources: SourceRecord[], selection: SplitSelection[]) {
  const highestPosition = selection.reduce((highest, entry) => Math.max(highest, entry.position), 0);
  const results: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const entry of selection) {
    const bytes = await buildPdf(sources, [entry.page]);
    results.push({ name: splitEntryName(entry.position, highestPosition), bytes });
  }
  return results;
}

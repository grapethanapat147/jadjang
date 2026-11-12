import { formatBytes, type PageBox, type PageRecord } from "./pdf-engine.ts";
import { isImageOfFormat, type ImageFormat } from "./verify-output.ts";

export type RenderedPage<TCanvas> = {
  canvas: TCanvas;
  pageBox: PageBox;
};

/**
 * Everything these builders need from the browser.
 *
 * Only rasterising and encoding actually require a canvas, so injecting just
 * those two keeps the ordering, guardrails, naming and integrity checks
 * runnable — and testable — outside a browser.
 */
export type OutputBuilderDeps<TCanvas> = {
  renderPage: (page: PageRecord, scale: number) => Promise<RenderedPage<TCanvas>>;
  encode: (canvas: TCanvas, mimeType: string, quality?: number) => Promise<Blob>;
  reportProgress?: (label: string, percent: number) => void;
  yieldControl?: () => Promise<void>;
};

export type CompressionLevel = "small" | "balanced" | "quality";

export type CompressionSetting = {
  scale: number;
  quality: number;
  label: string;
};

export const COMPRESSION_SETTINGS: Record<CompressionLevel, CompressionSetting> = {
  small: { scale: 1.05, quality: 0.52, label: "ไฟล์เล็ก" },
  balanced: { scale: 1.35, quality: 0.68, label: "สมดุล" },
  quality: { scale: 1.65, quality: 0.82, label: "คมชัด" },
};

export const MAX_PNG_PAGES = 60;

const YIELD_EVERY_PAGES = 3;
const EMPTY_DOCUMENT_MESSAGE = "เอกสารต้องมีอย่างน้อย 1 หน้า";

export function imageEntryName(index: number, format: ImageFormat): string {
  return `page-${String(index + 1).padStart(3, "0")}.${format}`;
}

function imageMimeType(format: ImageFormat): string {
  return format === "png" ? "image/png" : "image/jpeg";
}

export async function buildCompressedPdf<TCanvas>(
  pages: PageRecord[],
  level: CompressionLevel,
  deps: OutputBuilderDeps<TCanvas>,
): Promise<Uint8Array> {
  if (!pages.length) {
    throw new Error(EMPTY_DOCUMENT_MESSAGE);
  }

  const { PDFDocument } = await import("pdf-lib");
  const setting = COMPRESSION_SETTINGS[level];
  const output = await PDFDocument.create();

  for (let index = 0; index < pages.length; index += 1) {
    const { canvas, pageBox } = await deps.renderPage(pages[index], setting.scale);
    const encoded = await deps.encode(canvas, "image/jpeg", setting.quality);
    const image = await output.embedJpg(await encoded.arrayBuffer());
    const outputPage = output.addPage([pageBox.pageWidth, pageBox.pageHeight]);
    outputPage.drawImage(image, {
      x: pageBox.x,
      y: pageBox.y,
      width: pageBox.drawWidth,
      height: pageBox.drawHeight,
    });

    deps.reportProgress?.(
      `กำลังบีบอัดหน้า ${index + 1} จาก ${pages.length}`,
      Math.round(((index + 1) / pages.length) * 88),
    );
    if (index % YIELD_EVERY_PAGES === 0) {
      await deps.yieldControl?.();
    }
  }

  output.setTitle("จัดแจง — ไฟล์บีบอัด");
  output.setProducer("จัดแจง");
  return output.save({ useObjectStreams: true });
}

// ------------------------------------------------------- compress to a size --

const MB = 1024 * 1024;

/** Upload limits Thai forms actually set: TCAS asks for 2 MB, many others go lower. */
export const TARGET_SIZES = [
  { bytes: 2 * MB, label: "2 MB" },
  { bytes: 1 * MB, label: "1 MB" },
  { bytes: 500 * 1024, label: "500 KB" },
] as const;

/** Tried from sharpest to smallest; each scale is rendered once and encoded at every quality. */
const TARGET_SCALES = [1.35, 1.05, 0.8, 0.6];
const TARGET_QUALITIES = [0.78, 0.62, 0.48, 0.35];

export type TargetResult = { bytes: Uint8Array; reached: boolean; scale: number; quality: number };

async function assemblePdf(images: Blob[], boxes: PageBox[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const output = await PDFDocument.create();
  for (let index = 0; index < images.length; index += 1) {
    const image = await output.embedJpg(await images[index].arrayBuffer());
    const box = boxes[index];
    output.addPage([box.pageWidth, box.pageHeight]).drawImage(image, { x: box.x, y: box.y, width: box.drawWidth, height: box.drawHeight });
  }
  output.setTitle("จัดแจง — ไฟล์บีบอัด");
  output.setProducer("จัดแจง");
  return output.save({ useObjectStreams: true });
}

/**
 * The sharpest result that fits under `targetBytes`. Rendering is the slow
 * part, so each scale is rendered once and encoded at every quality, and the
 * PDF is only assembled for a quality whose images already fit. If nothing
 * fits, the smallest attempt comes back with `reached: false` so the caller
 * can say so instead of pretending.
 */
export async function buildPdfUnderSize<TCanvas>(
  pages: PageRecord[],
  targetBytes: number,
  deps: OutputBuilderDeps<TCanvas>,
): Promise<TargetResult> {
  if (!pages.length) {
    throw new Error(EMPTY_DOCUMENT_MESSAGE);
  }

  let smallest: { images: Blob[]; boxes: PageBox[]; scale: number } | null = null;
  for (let round = 0; round < TARGET_SCALES.length; round += 1) {
    const scale = TARGET_SCALES[round];
    const encoded: Blob[][] = TARGET_QUALITIES.map(() => []);
    const boxes: PageBox[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      const { canvas, pageBox } = await deps.renderPage(pages[index], scale);
      boxes.push(pageBox);
      for (let level = 0; level < TARGET_QUALITIES.length; level += 1) {
        encoded[level].push(await deps.encode(canvas, "image/jpeg", TARGET_QUALITIES[level]));
      }
      deps.reportProgress?.(
        `กำลังหาความคมชัดที่ได้ขนาดพอดี · รอบ ${round + 1} หน้า ${index + 1}/${pages.length}`,
        Math.round(((round + (index + 1) / pages.length) / TARGET_SCALES.length) * 88),
      );
      if (index % YIELD_EVERY_PAGES === 0) {
        await deps.yieldControl?.();
      }
    }

    for (let level = 0; level < TARGET_QUALITIES.length; level += 1) {
      const imageBytes = encoded[level].reduce((sum, blob) => sum + blob.size, 0);
      if (imageBytes > targetBytes) continue;
      const bytes = await assemblePdf(encoded[level], boxes);
      if (bytes.length <= targetBytes) {
        return { bytes, reached: true, scale, quality: TARGET_QUALITIES[level] };
      }
    }
    smallest = { images: encoded[TARGET_QUALITIES.length - 1], boxes, scale };
  }

  const bytes = await assemblePdf(smallest!.images, smallest!.boxes);
  return { bytes, reached: false, scale: smallest!.scale, quality: TARGET_QUALITIES[TARGET_QUALITIES.length - 1] };
}

/** Wording for a size-targeted result, including when the target could not be met. */
export function targetNote(options: { outputBytes: number; targetLabel: string; pageCount: number; reached: boolean; kept: boolean }): string {
  const { outputBytes, targetLabel, pageCount, reached, kept } = options;
  if (kept) {
    return `ไฟล์เดิม ${formatBytes(outputBytes)} ไม่เกิน ${targetLabel} อยู่แล้ว จึงไม่ลดความคมชัด และข้อความยังค้นหาได้ · ตรวจครบ ${pageCount} หน้า`;
  }
  if (!reached) {
    return `เล็กสุดที่ทำได้คือ ${formatBytes(outputBytes)} ยังเกิน ${targetLabel} ลองแบ่งไฟล์ด้วย “แยกหน้า PDF” แล้วส่งทีละส่วน`;
  }
  return `ได้ ${formatBytes(outputBytes)} ไม่เกิน ${targetLabel} · ตรวจครบ ${pageCount} หน้า · แต่ละหน้าเป็นภาพ จึงค้นหาข้อความไม่ได้`;
}

export async function buildImageArchive<TCanvas>(
  pages: PageRecord[],
  format: ImageFormat,
  deps: OutputBuilderDeps<TCanvas>,
): Promise<{ blob: Blob; entryCount: number }> {
  if (!pages.length) {
    throw new Error(EMPTY_DOCUMENT_MESSAGE);
  }
  if (format === "png" && pages.length > MAX_PNG_PAGES) {
    throw new Error(
      `การแปลง PNG จำกัด ${MAX_PNG_PAGES} หน้าต่อครั้ง กรุณาเลือก JPG หรือแบ่งไฟล์`,
    );
  }

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const mimeType = imageMimeType(format);

  for (let index = 0; index < pages.length; index += 1) {
    const { canvas } = await deps.renderPage(pages[index], format === "png" ? 1.5 : 1.25);
    const encoded = await deps.encode(canvas, mimeType, format === "jpg" ? 0.82 : undefined);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    if (!bytes.length || !isImageOfFormat(bytes, format)) {
      throw new Error(
        `สร้างภาพของหน้า ${index + 1} ไม่สำเร็จ ระบบจึงหยุดดาวน์โหลดเพื่อความปลอดภัย`,
      );
    }

    zip.file(imageEntryName(index, format), bytes);
    deps.reportProgress?.(
      `กำลังแปลงหน้า ${index + 1} จาก ${pages.length}`,
      Math.round(((index + 1) / pages.length) * 82),
    );
    if (index % YIELD_EVERY_PAGES === 0) {
      await deps.yieldControl?.();
    }
  }

  const blob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    ({ percent }) =>
      deps.reportProgress?.("กำลังรวมรูปเป็นไฟล์ ZIP", 82 + Math.round(percent * 0.16)),
  );

  return { blob, entryCount: pages.length };
}

/**
 * Honest wording for a compressed result.
 *
 * A percentage is only claimed when the workspace still holds every page that
 * was read, because otherwise the saving being reported is partly the pages the
 * user deleted rather than the compression.
 */
export function compressionNote(options: {
  inputBytes: number;
  outputBytes: number;
  pageCount: number;
  comparableToInput: boolean;
}): string {
  const { inputBytes, outputBytes, pageCount, comparableToInput } = options;
  const checked = `ตรวจครบ ${pageCount} หน้า`;

  if (!comparableToInput) {
    return `${checked} — มีการลบหน้าออก จึงไม่เทียบขนาดกับไฟล์ต้นฉบับ`;
  }
  if (inputBytes <= 0) {
    return checked;
  }
  if (outputBytes >= inputBytes) {
    return `ไฟล์ใหม่ไม่เล็กลง แต่${checked} — ลองระดับ “ไฟล์เล็ก” เพื่อผลที่ดีกว่า`;
  }

  const saved = Math.max(1, Math.round(((inputBytes - outputBytes) / inputBytes) * 100));
  return `ลดลง ${saved}% จาก ${formatBytes(inputBytes)} และ${checked}`;
}

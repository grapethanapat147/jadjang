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

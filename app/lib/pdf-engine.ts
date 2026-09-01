import type { PDFDocument as PDFDocumentType, Rotation } from "pdf-lib";

export const MAX_FILES = 24;
export const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
export const MAX_SINGLE_BYTES = 120 * 1024 * 1024;
export const MAX_PAGES = 250;

export type SourceRecord = {
  id: string;
  name: string;
  type: "pdf" | "jpg" | "png";
  bytes: ArrayBuffer;
  size: number;
};

export type PageRecord = {
  id: string;
  sourceId: string;
  pageNumber: number;
  rotation: number;
};

type UploadCandidate = Pick<File, "name" | "size" | "type">;
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

export function movePage<T>(items: T[], from: number, to: number) {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
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

  const data = new Uint8Array(source.bytes.slice(0));
  const image = source.type === "png" ? await output.embedPng(data) : await output.embedJpg(data);
  const isLandscape = image.width > image.height;
  const pageWidth = isLandscape ? 841.89 : 595.28;
  const pageHeight = isLandscape ? 595.28 : 841.89;
  const margin = 24;
  const scale = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const imagePage = output.addPage([pageWidth, pageHeight]);
  imagePage.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  });
  imagePage.setRotation(degrees(normalizeRotation(page.rotation)));
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

export async function splitPdfPages(sources: SourceRecord[], pages: PageRecord[]) {
  const results: Array<{ name: string; bytes: Uint8Array }> = [];
  for (let index = 0; index < pages.length; index += 1) {
    const bytes = await buildPdf(sources, [pages[index]]);
    results.push({ name: `page-${String(index + 1).padStart(2, "0")}.pdf`, bytes });
  }
  return results;
}

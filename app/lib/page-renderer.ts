import {
  fillPageBox,
  fitImageOnA4,
  mimeTypeForSource,
  type PageRecord,
  type SourceRecord,
} from "./pdf-engine.ts";
import type { RenderedPage } from "./output-builder.ts";

type PdfViewportLike = {
  width: number;
  height: number;
  rotation?: number;
};

type PdfPageLike = {
  getViewport(options: { scale: number; rotation?: number }): PdfViewportLike;
  render(options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike;
  }): { promise: Promise<void> };
};

export type PdfDocumentLike = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
};

const PREVIEW_SCALE = 0.32;
const PREVIEW_QUALITY = 0.7;
const IMAGE_OUTPUT_MAX_EDGE = 1_250;

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("ไม่สามารถสร้างภาพผลลัพธ์ได้"))),
      mimeType,
      quality,
    );
  });
}

export type PageRenderer = {
  loadDocument(source: SourceRecord): Promise<PdfDocumentLike>;
  renderOutput(
    sources: SourceRecord[],
    page: PageRecord,
    scale: number,
  ): Promise<RenderedPage<HTMLCanvasElement>>;
  createPreview(source: SourceRecord, page: PageRecord): Promise<string>;
  releasePreview(url: string | undefined): void;
  releaseSource(sourceId: string): void;
  releaseAll(): void;
};

/**
 * Owns every browser resource the workspace allocates: parsed pdf.js documents
 * and preview object URLs.
 *
 * Keeping both in one place is what makes releasing them reliable — the
 * component only has to say which source or preview is finished, and never
 * has to remember which of the two caches a thing lives in.
 */
export function createPageRenderer(options: { pdfWorkerSrc: string }): PageRenderer {
  const documents = new Map<string, Promise<PdfDocumentLike>>();
  const previewUrls = new Set<string>();

  function loadDocument(source: SourceRecord): Promise<PdfDocumentLike> {
    const cached = documents.get(source.id);
    if (cached) {
      return cached;
    }

    const loading = (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = options.pdfWorkerSrc;
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(source.bytes.slice(0)),
        useWasm: true,
      });
      return (await loadingTask.promise) as unknown as PdfDocumentLike;
    })();
    documents.set(source.id, loading);
    return loading;
  }

  async function renderPdfCanvas(source: SourceRecord, page: PageRecord, scale: number) {
    const pdfDocument = await loadDocument(source);
    const pdfPage = await pdfDocument.getPage(page.pageNumber);
    const base = pdfPage.getViewport({ scale: 1 });
    const rotation = ((base.rotation ?? 0) + page.rotation) % 360;
    const viewport = pdfPage.getViewport({ scale, rotation });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("อุปกรณ์นี้ไม่รองรับการสร้าง Preview");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
    return { canvas, width: viewport.width / scale, height: viewport.height / scale };
  }

  async function renderImageCanvas(source: SourceRecord, page: PageRecord, maxEdge: number) {
    const blob = new Blob([source.bytes], { type: mimeTypeForSource(source.type) });
    const image = await createImageBitmap(blob);
    const rotation = ((page.rotation % 360) + 360) % 360;
    const rotated = rotation === 90 || rotation === 270;
    const rawWidth = rotated ? image.height : image.width;
    const rawHeight = rotated ? image.width : image.height;
    const scale = Math.min(1, maxEdge / Math.max(rawWidth, rawHeight));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rawWidth * scale));
    canvas.height = Math.max(1, Math.round(rawHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("อุปกรณ์นี้ไม่รองรับการแปลงรูป");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(
      image,
      -(image.width * scale) / 2,
      -(image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    context.restore();
    image.close();

    return { canvas, width: rawWidth, height: rawHeight };
  }

  return {
    loadDocument,

    /**
     * Always reports a page box in PDF points. The PDF path measures in points
     * already, while the image path measures in pixels and has to be fitted
     * before the value can be used as a page size.
     */
    async renderOutput(sources, page, scale) {
      const source = sources.find((item) => item.id === page.sourceId);
      if (!source) throw new Error("ไม่พบไฟล์ต้นฉบับ");

      if (source.type === "pdf") {
        const rendered = await renderPdfCanvas(source, page, scale);
        return { canvas: rendered.canvas, pageBox: fillPageBox(rendered.width, rendered.height) };
      }

      const rendered = await renderImageCanvas(
        source,
        page,
        Math.round(IMAGE_OUTPUT_MAX_EDGE * scale),
      );
      return { canvas: rendered.canvas, pageBox: fitImageOnA4(rendered.width, rendered.height) };
    },

    async createPreview(source, page) {
      if (source.type !== "pdf") {
        const url = URL.createObjectURL(
          new Blob([source.bytes], { type: mimeTypeForSource(source.type) }),
        );
        previewUrls.add(url);
        return url;
      }

      // Data URLs need no revoking, so PDF previews are not tracked.
      const { canvas } = await renderPdfCanvas(source, { ...page, rotation: 0 }, PREVIEW_SCALE);
      return canvas.toDataURL("image/jpeg", PREVIEW_QUALITY);
    },

    releasePreview(url) {
      if (!url || !previewUrls.has(url)) {
        return;
      }
      URL.revokeObjectURL(url);
      previewUrls.delete(url);
    },

    releaseSource(sourceId) {
      const cached = documents.get(sourceId);
      if (!cached) {
        return;
      }
      cached.then((pdfDocument) => pdfDocument.destroy()).catch(() => undefined);
      documents.delete(sourceId);
    },

    releaseAll() {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.clear();
      for (const loading of documents.values()) {
        loading.then((pdfDocument) => pdfDocument.destroy()).catch(() => undefined);
      }
      documents.clear();
    },
  };
}

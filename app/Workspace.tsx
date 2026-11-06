"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  MAX_PAGES,
  buildPdf,
  findOrphanedSourceIds,
  formatBytes,
  hasEveryPage,
  mimeTypeForSource,
  movePage,
  splitPdfPages,
  validateInputFiles,
  verifyPdfPageCount,
  type PageRecord,
  type SourceRecord,
  type UploadCandidate,
} from "./lib/pdf-engine";
import {
  AUTO_CLEAR_DELAY_SECONDS,
  createAutoClearTimer,
  type AutoClearTimer,
} from "./lib/auto-clear";
import { yieldToBrowser } from "./lib/yield-to-browser";
import { isImageOfFormat, verifyArchiveEntryCount, type ImageFormat } from "./lib/verify-output";
import {
  COMPRESSION_SETTINGS,
  buildCompressedPdf,
  buildImageArchive,
  compressionNote,
  type CompressionLevel,
  type OutputBuilderDeps,
} from "./lib/output-builder";
import { nextToolIndex } from "./lib/tool-navigation";
import { createDetailRenderQueue, sameRenderBox, type RenderBox } from "./lib/detail-render";
import { focusableWithin, nextTrapTarget } from "./lib/focus-trap";
import {
  EAGER_PREVIEW_LIMIT,
  previewState,
  unavailableReason,
} from "./lib/preview-state";
import { canvasToBlob, createPageRenderer } from "./lib/page-renderer";
import { isLeavingDropTarget } from "./lib/drag-and-drop";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { INSTALL_DISMISSED_KEY, installHint, isIosBrowser } from "./lib/install-hint";
import { pageBucket } from "./lib/usage";
import { reportUsage, reportVisitOnce } from "./lib/report-usage";
import { GAME_MODE_CHANGE_EVENT, readGameMode, subscribeGameMode, writeGameMode } from "./lib/game-mode";
import { Hoop, throwIntoHoop } from "./Hoop";
import { TOOLS, TOOL_CATEGORIES, toolById, toolFromPath, toolPath, type ToolCategory, type ToolId } from "./lib/tools";
import {
  addPageNumbers,
  nUp,
  readMetadata,
  readPageSizes,
  replaceWithImages,
  resizeToA4,
  sheetCount,
  stampImage,
  stripMetadata,
  type MetadataEntry,
  type RasterPage,
} from "./lib/pdf-tools";
import {
  blackOut,
  compressPhoto,
  dragToRect,
  imageFileToPng,
  photoNote,
  renderTextStamp,
  type NormalizedRect,
  type PngStamp,
} from "./lib/canvas-tools";
import { A4_LONG_EDGE, A4_SHORT_EDGE } from "./lib/pdf-engine";
import { DEFAULT_TOOL_OPTIONS, SIGN_WIDTH, ToolSettings, type ShownStamp, type ToolOptions } from "./ToolSettings";

/** Chromium's install prompt; not in the DOM typings yet. */
type InstallPromptEvent = Event & { prompt(): Promise<void> };

function readInstallDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

type WorkspacePage = PageRecord & {
  fileName: string;
  previewUrl?: string;
  previewFailed?: boolean;
  previewSkipped?: boolean;
};

type ResultFile = {
  name: string;
  url: string;
  size: number;
  type: "pdf" | "zip" | "jpg";
  note: string;
  pageCount: number;
};

type ProgressState = {
  label: string;
  percent: number;
};

/** PDF tools that take the workspace as one finished PDF and change it. */
const PDF_TRANSFORMS = new Set<ToolId>(["page-numbers", "watermark", "sign", "redact", "strip-metadata", "resize-a4", "n-up"]);

function sourceType(file: File): SourceRecord["type"] {
  const extension = file.name.toLowerCase().split(".").pop();
  if (file.type === "application/pdf" || extension === "pdf") return "pdf";
  if (file.type === "image/png" || extension === "png") return "png";
  return "jpg";
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypted/i.test(message)) {
    return "ไฟล์นี้มีรหัสผ่าน กรุณาปลดล็อกไฟล์ก่อนแล้วลองใหม่";
  }
  if (/invalid|corrupt|format|header|xref/i.test(message)) {
    return "อ่านไฟล์นี้ไม่ได้ ไฟล์อาจเสียหายหรือไม่ใช่ PDF ที่สมบูรณ์";
  }
  if (/memory|allocation|array buffer/i.test(message)) {
    return "อุปกรณ์มีหน่วยความจำไม่พอ กรุณาแบ่งไฟล์เป็นชุดเล็กลง";
  }
  return message || "เกิดข้อผิดพลาดระหว่างประมวลผล กรุณาลองใหม่";
}

export function Workspace({ initialTool, toolPage }: { initialTool: ToolId; toolPage: boolean }) {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [pages, setPages] = useState<WorkspacePage[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [detailPageId, setDetailPageId] = useState<string | null>(null);
  const [detailRender, setDetailRender] = useState<{ key: string; url: string | null } | null>(null);
  const [detailBox, setDetailBox] = useState<RenderBox | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>(initialTool);
  const [onToolPage, setOnToolPage] = useState(toolPage);
  // A tool's own page opens on its group, so on a phone the upload box is a
  // couple of cards down rather than thirteen.
  const [category, setCategory] = useState<ToolCategory | "all">(toolPage ? toolById(initialTool).category : "all");
  const [toolOptions, setToolOptions] = useState<ToolOptions>(DEFAULT_TOOL_OPTIONS);
  const [watermarkImage, setWatermarkImage] = useState<ShownStamp | null>(null);
  const [signature, setSignature] = useState<ShownStamp | null>(null);
  const [redactions, setRedactions] = useState<Record<string, NormalizedRect[]>>({});
  const [metadata, setMetadata] = useState<{ key: string; entries: MetadataEntry[] } | null>(null);
  const [compressionLevel, setCompressionLevel] = useState<CompressionLevel>("balanced");
  const [convertFormat, setImageFormat] = useState<ImageFormat>("jpg");
  const [result, setResult] = useState<ResultFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const gameMode = useSyncExternalStore(subscribeGameMode, () => readGameMode(globalThis.localStorage), () => false);

  const workspaceRef = useRef<HTMLElement | null>(null);
  const hoopRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const detailStageRef = useRef<HTMLDivElement | null>(null);
  const detailCloseRef = useRef<HTMLButtonElement | null>(null);
  const detailImageRef = useRef<HTMLImageElement | null>(null);
  /** The thumbnail the overlay was opened from, so focus can go back to it. */
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const toolListRef = useRef<HTMLDivElement | null>(null);
  const resultUrl = useRef<string | null>(null);
  const [renderer] = useState(() => createPageRenderer({ pdfWorkerSrc: pdfWorkerUrl }));
  const [autoClear] = useState<AutoClearTimer>(() => createAutoClearTimer());
  const [detailQueue] = useState(() => createDetailRenderQueue<string>());

  const totalInputSize = useMemo(
    () => sources.reduce((sum, source) => sum + source.size, 0),
    [sources],
  );
  const hasPdf = sources.some((source) => source.type === "pdf");
  const onlyImages = sources.length > 0 && sources.every((source) => source.type !== "pdf");
  const currentPage = pages.find((page) => page.id === currentPageId) ?? pages[0];
  const detailIndex = pages.findIndex((page) => page.id === detailPageId);
  const detailPage = detailIndex === -1 ? null : pages[detailIndex];
  /**
   * Rotation and the displayed size are both in the key: a rotated page needs
   * rendering again, and so does one the window has been resized around.
   */
  const detailKey =
    detailPage && detailBox && detailBox.width > 0 && detailBox.height > 0
      ? `${detailPage.id}:${detailPage.rotation}:${Math.round(detailBox.width)}x${Math.round(detailBox.height)}`
      : null;
  const detailIsCurrent = detailRender !== null && detailRender.key === detailKey;
  const detailImage =
    (detailIsCurrent ? detailRender.url : null) ?? detailPage?.previewUrl ?? null;
  const isSharpening = detailPage !== null && !detailIsCurrent;
  const activeToolOption = toolById(activeTool);
  const visibleTools = category === "all" ? TOOLS : TOOLS.filter((tool) => tool.category === category);
  const hasImages = sources.some((source) => source.type !== "pdf");
  const redaction = useMemo(() => {
    const live = pages.filter((page) => redactions[page.id]?.length);
    return { marks: live.reduce((sum, page) => sum + redactions[page.id].length, 0), pages: live.length };
  }, [pages, redactions]);
  const metadataKey = sources.filter((source) => source.type === "pdf").map((source) => source.id).join(",");

  async function clearWorkspace() {
    autoClear.cancel();
    renderer.releaseAll();
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
    setSources([]);
    setPages([]);
    setSelectedIds(new Set());
    setCurrentPageId(null);
    setDetailPageId(null);
    setDetailRender(null);
    detailQueue.clear();
    setResult(null);
    setError(null);
    setWarning(null);
    setProgress(null);
    setRedactions({});
    setMetadata(null);
    // A signature is as personal as the document it was made for.
    replaceStamp(setSignature, null);
    replaceStamp(setWatermarkImage, null);
  }

  /** Swaps a shown stamp, releasing the object URL of the one it replaces. */
  function replaceStamp(setter: typeof setSignature, stamp: PngStamp | null) {
    setter((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return stamp ? { ...stamp, url: URL.createObjectURL(new Blob([stamp.bytes as BlobPart], { type: "image/png" })) } : null;
    });
  }

  function setOption<K extends keyof ToolOptions>(key: K, value: ToolOptions[K]) {
    setToolOptions((current) => ({ ...current, [key]: value }));
    setResult(null);
  }

  async function chooseWatermarkImage(file: File) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setError("ลายน้ำใช้ได้เฉพาะรูป PNG หรือ JPG");
      return;
    }
    try {
      replaceStamp(setWatermarkImage, await imageFileToPng(file));
      setResult(null);
    } catch {
      setError("อ่านรูปโลโก้นี้ไม่ได้ ลองรูปอื่น");
    }
  }

  useEffect(() => {
    return () => {
      autoClear.cancel();
      renderer.releaseAll();
      detailQueue.clear();
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    };
  }, [autoClear, renderer, detailQueue]);

  useEffect(() => {
    // Held back so the offer comes after a file has come out right, not on arrival.
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    reportVisitOnce({
      referrer: document.referrer,
      host: location.host,
      storage: (() => {
        try {
          return window.sessionStorage;
        } catch {
          return null;
        }
      })(),
    });
  }, []);

  useEffect(() => {
    // Dev is served unhashed and hot-reloaded, so caching it would fight HMR.
    if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    // Offline, every tool address is answered with the cached home page, so
    // the address itself says which tool was meant.
    const fromPath = toolFromPath(window.location.pathname);
    if (fromPath && fromPath !== initialTool) {
      // Only differs from the server's choice offline, so this runs at most once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTool(fromPath);
      setOnToolPage(true);
    }
  }, [initialTool]);

  useEffect(() => {
    if (activeTool !== "strip-metadata" || !metadataKey || metadata?.key === metadataKey) return;
    let cancelled = false;
    const pdfs = sources.filter((source) => source.type === "pdf");
    Promise.all(pdfs.map((source) => readMetadata(source.bytes.slice(0)).catch(() => [])))
      .then((lists) => {
        if (!cancelled) setMetadata({ key: metadataKey, entries: lists.flat() });
      });
    return () => {
      cancelled = true;
    };
    // Re-read only when the set of PDFs changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, metadataKey]);

  function updatePreviewState(pageId: string, update: Partial<WorkspacePage>) {
    setPages((items) => items.map((item) => (item.id === pageId ? { ...item, ...update } : item)));
  }

  function requestPreview(page: WorkspacePage) {
    const source = sources.find((item) => item.id === page.sourceId);
    if (!source) return;

    renderer
      .createPreview(source, page)
      .then((url) => updatePreviewState(page.id, { previewUrl: url, previewFailed: false }))
      // Recorded on the page itself so the user can retry, rather than leaving
      // a placeholder that looks like it is still working.
      .catch(() => updatePreviewState(page.id, { previewFailed: true }));
  }

  useEffect(() => {
    // A failed preview waits for the user to retry instead of looping.
    if (!currentPage || currentPage.previewUrl || currentPage.previewFailed) return;
    requestPreview(currentPage);
    // Rendering is intentionally keyed to the active page only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId]);

  function retryPreview(page: WorkspacePage) {
    updatePreviewState(page.id, { previewFailed: false, previewSkipped: false });
    requestPreview(page);
  }

  function openDetail(pageId: string, opener: HTMLElement | null) {
    detailOpenerRef.current = opener;
    setDetailPageId(pageId);
  }

  function closeDetail() {
    setDetailPageId(null);
    // Focus belongs back on the thumbnail the overlay was opened from, not at
    // the top of the document.
    const opener = detailOpenerRef.current;
    detailOpenerRef.current = null;
    opener?.focus();
  }

  function stepDetail(delta: number) {
    const next = pages[detailIndex + delta];
    if (next) setDetailPageId(next.id);
  }

  function handleDetailKeyDown(event: globalThis.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDetail();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      stepDetail(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (event.key !== "Tab" || !overlayRef.current) return;

    // Tab must not reach the workspace behind the dialog.
    const controls = focusableWithin(overlayRef.current);
    const target = nextTrapTarget(
      controls,
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
      event.shiftKey,
    );
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  useEffect(() => {
    // Opening a dialog moves focus into it; nothing else in the overlay is a
    // safe landing point, because the arrows can be disabled at either end.
    if (detailPageId) detailCloseRef.current?.focus();
  }, [detailPageId]);

  useEffect(() => {
    if (!detailPageId) return;
    document.addEventListener("keydown", handleDetailKeyDown);
    return () => document.removeEventListener("keydown", handleDetailKeyDown);
    // Rebound as the position in the document changes, so the arrow keys always
    // step from the page currently shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailPageId, detailIndex, pages.length]);

  useEffect(() => {
    const frame = detailStageRef.current;
    if (!detailPageId || !frame) return;

    // Measured continuously rather than once. The frame comes back zero when
    // the overlay mounts in a tab that has not been laid out, and a one-shot
    // read would leave the overlay on the blurry thumbnail for good.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDetailBox((current) => (sameRenderBox(current, { width, height }) ? current : { width, height }));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [detailPageId]);

  useEffect(() => {
    if (!detailPage || !detailKey || !detailBox) return;
    const source = sources.find((item) => item.id === detailPage.sourceId);
    const box = detailBox;
    if (!source) return;

    let cancelled = false;
    detailQueue
      .request(detailKey, () =>
        renderer.renderDetail(source, detailPage, box, window.devicePixelRatio || 1),
      )
      // A null result means a later page overtook this render, so it is dropped
      // rather than painted over the page the user is now looking at.
      .then((url) => {
        if (!cancelled && url !== null) setDetailRender({ key: detailKey, url });
      })
      // Recorded against the key so the overlay stops saying it is working and
      // keeps the thumbnail it already had.
      .catch(() => {
        if (!cancelled) setDetailRender({ key: detailKey, url: null });
      });

    return () => {
      cancelled = true;
    };
    // Re-renders when the page, its rotation or its displayed size changes,
    // which is what the key is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey]);

  async function addFiles(incoming: File[]) {
    const candidates: UploadCandidate[] = [
      ...sources.map((source) => ({
        name: source.name,
        size: source.size,
        type: mimeTypeForSource(source.type),
      })),
      ...incoming,
    ];
    const validationError = validateInputFiles(candidates);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Fetch the processing code while the user is still online and looking at
    // previews, so losing the connection before pressing the button is harmless.
    void import("pdf-lib").catch(() => undefined);
    void import("jszip").catch(() => undefined);

    autoClear.cancel();
    setIsBusy(true);
    setError(null);
    setResult(null);
    setProgress({ label: "กำลังอ่านไฟล์อย่างปลอดภัย", percent: 5 });

    const newSources: SourceRecord[] = [];
    const newPages: WorkspacePage[] = [];

    try {
      let discoveredPages = pages.length;

      for (let fileIndex = 0; fileIndex < incoming.length; fileIndex += 1) {
        const file = incoming[fileIndex];
        const id = crypto.randomUUID();
        const type = sourceType(file);
        const bytes = await file.arrayBuffer();
        const source: SourceRecord = { id, name: file.name, size: file.size, type, bytes, pageCount: 1 };
        newSources.push(source);

        if (type === "pdf") {
          const document = await renderer.loadDocument(source);
          source.pageCount = document.numPages;
          if (discoveredPages + document.numPages > MAX_PAGES) {
            throw new Error(`รองรับได้สูงสุด ${MAX_PAGES} หน้าต่อครั้ง กรุณาแบ่งไฟล์เป็นชุดเล็กลง`);
          }
          for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            const page: WorkspacePage = {
              id: crypto.randomUUID(),
              sourceId: id,
              pageNumber,
              rotation: 0,
              fileName: file.name,
            };
            if (newPages.length < EAGER_PREVIEW_LIMIT) {
              page.previewUrl = await renderer.createPreview(source, page);
            } else {
              page.previewSkipped = true;
            }
            newPages.push(page);
            if (pageNumber % 8 === 0) await yieldToBrowser();
            setProgress({
              label: `กำลังสร้าง Preview: ${file.name}`,
              percent: Math.min(88, 10 + Math.round(((fileIndex + pageNumber / document.numPages) / incoming.length) * 76)),
            });
          }
          discoveredPages += document.numPages;
        } else {
          if (discoveredPages + 1 > MAX_PAGES) throw new Error(`รองรับได้สูงสุด ${MAX_PAGES} หน้า`);
          const page: WorkspacePage = {
            id: crypto.randomUUID(),
            sourceId: id,
            pageNumber: 1,
            rotation: 0,
            fileName: file.name,
          };
          page.previewUrl = await renderer.createPreview(source, page);
          newPages.push(page);
          discoveredPages += 1;
        }
      }

      const combinedPages = [...pages, ...newPages];
      setSources((items) => [...items, ...newSources]);
      setPages(combinedPages);
      setSelectedIds(new Set(combinedPages.map((page) => page.id)));
      setCurrentPageId((value) => value ?? combinedPages[0]?.id ?? null);
      setWarning(
        candidates.reduce((sum, file) => sum + file.size, 0) > 40 * 1024 * 1024 ||
          combinedPages.length > 80
          ? "ไฟล์ชุดนี้มีขนาดใหญ่ ระบบจะสร้าง Preview เท่าที่จำเป็นเพื่อประหยัดหน่วยความจำ"
          : null,
      );
      // Photos alone on the default tool most likely want to become a PDF; on a
      // tool someone chose, their choice stands.
      if (newSources.every((source) => source.type !== "pdf") && !hasPdf && activeTool === "organize" && !onToolPage) setActiveTool("convert");
      setProgress({ label: "พร้อมจัดการเอกสาร", percent: 100 });
      window.setTimeout(() => {
        setProgress(null);
        workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 350);
    } catch (caught) {
      // Nothing from this batch reached state, so release what it already
      // allocated instead of leaving parsed documents in memory for the session.
      newPages.forEach((page) => renderer.releasePreview(page.previewUrl));
      newSources.forEach((source) => renderer.releaseSource(source.id));
      setError(friendlyError(caught));
      setProgress(null);
    } finally {
      setIsBusy(false);
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    void addFiles(files);
    if (gameMode) {
      // Thrown from the button that opened the picker.
      const button = hoopRef.current?.parentElement?.querySelector(".primary-button")?.getBoundingClientRect();
      if (button) throwIntoHoop(hoopRef.current, { x: button.left + button.width / 2, y: button.top + button.height / 2 }, files.map((file) => file.name));
    }
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!isBusy) setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (isLeavingDropTarget(event.currentTarget, event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isBusy) return;
    const files = Array.from(event.dataTransfer.files);
    void addFiles(files);
    if (gameMode) throwIntoHoop(hoopRef.current, { x: event.clientX, y: event.clientY }, files.map((file) => file.name));
  }

  function updatePage(id: string, update: Partial<WorkspacePage>) {
    setPages((items) => items.map((item) => (item.id === id ? { ...item, ...update } : item)));
  }

  function removePage(id: string) {
    if (pages.length === 1) {
      setError("เอกสารต้องเหลืออย่างน้อย 1 หน้า");
      return;
    }

    const removed = pages.find((page) => page.id === id);
    const remaining = pages.filter((page) => page.id !== id);
    const orphanedSourceIds = findOrphanedSourceIds(
      sources.map((source) => source.id),
      remaining,
    );

    renderer.releasePreview(removed?.previewUrl);
    orphanedSourceIds.forEach((sourceId) => renderer.releaseSource(sourceId));

    setPages(remaining);
    if (orphanedSourceIds.length) {
      const dropped = new Set(orphanedSourceIds);
      setSources((items) => items.filter((source) => !dropped.has(source.id)));
    }
    setCurrentPageId((value) => (value === id ? remaining[0]?.id ?? null : value));
    setDetailPageId((value) => (value === id ? null : value));
    setSelectedIds((items) => {
      const next = new Set(items);
      next.delete(id);
      return next;
    });
    setResult(null);
  }

  function rotatePage(page: WorkspacePage) {
    updatePage(page.id, { rotation: (page.rotation + 90) % 360 });
    // Boxes are drawn on the page as it looked, so they would land on the wrong spot.
    if (redactions[page.id]) {
      setRedactions((current) => {
        const next = { ...current };
        delete next[page.id];
        return next;
      });
    }
    setResult(null);
  }

  function reorderPage(index: number, direction: -1 | 1) {
    setPages((items) => movePage(items, index, index + direction));
    setResult(null);
  }

  function toggleSelected(id: string) {
    setSelectedIds((items) => {
      const next = new Set(items);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setDownloadResult(blob: Blob, name: string, type: ResultFile["type"], note: string, pageCount: number) {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    const url = URL.createObjectURL(blob);
    resultUrl.current = url;
    setResult({ name, url, size: blob.size, type, note, pageCount });
  }

  async function processDocument() {
    if (!pages.length || isBusy) return;
    autoClear.cancel();
    setIsBusy(true);
    setError(null);
    setProgress({ label: "กำลังเตรียมเอกสาร", percent: 3 });

    const outputDeps: OutputBuilderDeps<HTMLCanvasElement> = {
      renderPage: (page, scale) => renderer.renderOutput(sources, page, scale),
      encode: canvasToBlob,
      reportProgress: (label, percent) => setProgress({ label, percent }),
      yieldControl: yieldToBrowser,
    };

    try {
      if (activeTool === "split") {
        const selection = pages
          .map((page, index) => ({ page, position: index + 1 }))
          .filter((entry) => selectedIds.has(entry.page.id));
        if (!selection.length) throw new Error("กรุณาเลือกหน้าที่ต้องการแยกอย่างน้อย 1 หน้า");
        if (selection.length === 1) {
          const bytes = await buildPdf(sources, [selection[0].page]);
          await verifyPdfPageCount(bytes, 1);
          setDownloadResult(
            new Blob([bytes as BlobPart], { type: "application/pdf" }),
            "จัดแจง-หน้าที่เลือก.pdf",
            "pdf",
            `ตรวจสอบแล้ว: ผลลัพธ์มีหน้า ${selection[0].position} เพียงหน้าเดียวตามที่เลือก`,
            1,
          );
        } else {
          const files = await splitPdfPages(sources, selection);
          for (let index = 0; index < files.length; index += 1) {
            setProgress({
              label: `กำลังตรวจไฟล์ที่ ${index + 1} จาก ${files.length}`,
              percent: 40 + Math.round(((index + 1) / files.length) * 45),
            });
            await verifyPdfPageCount(files[index].bytes, 1);
            if (index % 8 === 0) await yieldToBrowser();
          }
          const { default: JSZip } = await import("jszip");
          const zip = new JSZip();
          files.forEach((file) => zip.file(file.name, file.bytes));
          const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
          await verifyArchiveEntryCount(blob, files.length);
          setDownloadResult(
            blob,
            "จัดแจง-แยกหน้า.zip",
            "zip",
            `ตรวจสอบแล้ว: ภายในมี PDF หน้าละไฟล์ ครบ ${files.length} ไฟล์`,
            files.length,
          );
        }
      } else if (activeTool === "image-compress") {
        await runImageCompress();
      } else if (PDF_TRANSFORMS.has(activeTool)) {
        await runPdfTransform(activeTool);
      } else if (activeTool === "compress") {
        const bytes = await buildCompressedPdf(pages, compressionLevel, outputDeps);
        await verifyPdfPageCount(bytes, pages.length);
        setDownloadResult(
          new Blob([bytes as BlobPart], { type: "application/pdf" }),
          "จัดแจง-บีบอัด.pdf",
          "pdf",
          compressionNote({
            inputBytes: totalInputSize,
            outputBytes: bytes.length,
            pageCount: pages.length,
            comparableToInput: hasEveryPage(sources, pages),
          }),
          pages.length,
        );
      } else if (activeTool === "convert" && hasPdf) {
        const { blob, entryCount } = await buildImageArchive(pages, convertFormat, outputDeps);
        await verifyArchiveEntryCount(blob, entryCount);
        setDownloadResult(
          blob,
          `จัดแจง-${convertFormat.toUpperCase()}.zip`,
          "zip",
          `ตรวจสอบแล้ว: ภายในมีภาพ ${convertFormat.toUpperCase()} ครบ ${entryCount} ไฟล์`,
          entryCount,
        );
      } else {
        const bytes = await buildPdf(sources, pages);
        await verifyPdfPageCount(bytes, pages.length);
        setDownloadResult(
          new Blob([bytes as BlobPart], { type: "application/pdf" }),
          onlyImages ? "จัดแจง-จากรูป.pdf" : "จัดแจง-พร้อมส่ง.pdf",
          "pdf",
          `ตรวจสอบจำนวนและลำดับครบ ${pages.length} หน้าแล้ว`,
          pages.length,
        );
      }
      setProgress({ label: "ตรวจสอบผลลัพธ์เรียบร้อย", percent: 100 });
      reportUsage({ kind: "run", tool: activeTool, outcome: "success", pages: pageBucket(pages.length) });
      window.setTimeout(() => {
        setProgress(null);
        document.getElementById("download-result")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    } catch (caught) {
      setError(friendlyError(caught));
      setProgress(null);
      reportUsage({ kind: "run", tool: activeTool, outcome: "failure", pages: pageBucket(pages.length) });
    } finally {
      setIsBusy(false);
    }
  }

  async function runImageCompress() {
    if (hasPdf) throw new Error("เครื่องมือนี้ใช้กับรูป JPG / PNG เท่านั้น ถ้าต้องการลดขนาด PDF ให้ใช้ “บีบอัด PDF”");
    const outputs: Blob[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const source = sources.find((item) => item.id === page.sourceId);
      if (!source) throw new Error("ไม่พบไฟล์ต้นฉบับของบางรูป กรุณาเริ่มใหม่");
      const blob = await compressPhoto(new Blob([source.bytes], { type: mimeTypeForSource(source.type) }), page.rotation, toolOptions.imageLevel);
      if (!isImageOfFormat(new Uint8Array(await blob.slice(0, 4).arrayBuffer()), "jpg")) {
        throw new Error(`ย่อรูปที่ ${index + 1} ไม่สำเร็จ ระบบจึงหยุดดาวน์โหลดเพื่อความปลอดภัย`);
      }
      outputs.push(blob);
      setProgress({ label: `กำลังย่อรูปที่ ${index + 1} จาก ${pages.length}`, percent: Math.round(((index + 1) / pages.length) * 85) });
      await yieldToBrowser();
    }
    const outputBytes = outputs.reduce((sum, blob) => sum + blob.size, 0);
    const note = photoNote(totalInputSize, outputBytes, outputs.length, hasEveryPage(sources, pages));
    if (outputs.length === 1) {
      setDownloadResult(outputs[0], "จัดแจง-ย่อรูป.jpg", "jpg", note, 1);
      return;
    }
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    outputs.forEach((blob, index) => zip.file(`photo-${String(index + 1).padStart(3, "0")}.jpg`, blob));
    const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });
    await verifyArchiveEntryCount(archive, outputs.length);
    setDownloadResult(archive, "จัดแจง-ย่อรูป.zip", "zip", note, outputs.length);
  }

  async function watermarkStamp(): Promise<PngStamp> {
    if (toolOptions.watermarkKind === "image") {
      if (!watermarkImage) throw new Error("ยังไม่ได้เลือกรูปโลโก้สำหรับลายน้ำ");
      return watermarkImage;
    }
    const text = toolOptions.watermarkText.trim();
    if (!text) throw new Error("กรุณาพิมพ์ข้อความลายน้ำ");
    return renderTextStamp(text, "#3b4a6b");
  }

  /** Builds the workspace into one PDF, then applies the active tool to it. */
  async function runPdfTransform(tool: ToolId) {
    if (tool === "strip-metadata" && hasImages) {
      throw new Error("เครื่องมือนี้ใช้กับ PDF เท่านั้น ถ้าต้องการลบข้อมูลตำแหน่งในรูป ให้ใช้ “ย่อรูป”");
    }
    if (tool === "sign" && !signature) throw new Error("ยังไม่มีลายเซ็น วาดหรือเลือกรูปลายเซ็นก่อน");
    if (tool === "redact" && !redaction.marks) throw new Error("ยังไม่ได้ลากกรอบปิดข้อมูล แตะหน้าที่ต้องการเพื่อเปิดแบบเต็มจอ แล้วลากกรอบ");

    setProgress({ label: "กำลังรวมหน้าตามลำดับ", percent: 15 });
    const base = await buildPdf(sources, pages);
    setProgress({ label: `กำลัง${toolById(tool).label}`, percent: 45 });
    let bytes: Uint8Array;
    let expectedPages = pages.length;
    let note: string;

    if (tool === "page-numbers") {
      bytes = await addPageNumbers(base, { position: toolOptions.numberPosition, format: toolOptions.numberFormat });
      note = `ใส่เลขหน้าครบ ${pages.length} หน้า และตรวจจำนวนหน้าแล้ว`;
    } else if (tool === "watermark") {
      const stamp = await watermarkStamp();
      const diagonal = toolOptions.watermarkPlacement === "diagonal";
      bytes = await stampImage(
        base,
        stamp,
        diagonal ? { kind: "diagonal", widthRatio: 0.62 } : { kind: "corner", corner: "bottom-right", widthRatio: 0.24 },
        { opacity: diagonal ? 0.22 : 0.85 },
      );
      note = `ใส่ลายน้ำครบ ${pages.length} หน้า และตรวจจำนวนหน้าแล้ว`;
    } else if (tool === "sign") {
      const pageNumber = Math.min(toolOptions.signPage ?? pages.length, pages.length);
      bytes = await stampImage(
        base,
        signature!,
        { kind: "corner", corner: toolOptions.signCorner, widthRatio: SIGN_WIDTH[toolOptions.signSize] },
        { opacity: 1, pageIndexes: [pageNumber - 1] },
      );
      note = `วางลายเซ็นบนหน้า ${pageNumber} แล้ว และตรวจจำนวนหน้าแล้ว`;
    } else if (tool === "redact") {
      const rasters: RasterPage[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        const rects = redactions[pages[index].id];
        if (!rects?.length) continue;
        const { canvas, pageBox } = await renderer.renderOutput(sources, pages[index], 2);
        rasters.push({
          index,
          png: await blackOut(canvas, rects),
          pageWidth: pageBox.pageWidth,
          pageHeight: pageBox.pageHeight,
          draw: { x: pageBox.x, y: pageBox.y, width: pageBox.drawWidth, height: pageBox.drawHeight },
        });
        setProgress({ label: `กำลังปิดทึบหน้า ${index + 1}`, percent: 45 + Math.round(((index + 1) / pages.length) * 40) });
        await yieldToBrowser();
      }
      bytes = await replaceWithImages(base, rasters);
      note = `ปิดทึบ ${redaction.marks} จุดใน ${rasters.length} หน้า ข้อความใต้กรอบถูกลบออกจริง`;
    } else if (tool === "strip-metadata") {
      bytes = await stripMetadata(base);
      if ((await readMetadata(bytes)).length) throw new Error("ยังลบข้อมูลแฝงได้ไม่ครบ ระบบจึงหยุดดาวน์โหลดเพื่อความปลอดภัย");
      note = "ลบข้อมูลแฝงแล้ว เปิดไฟล์ตรวจซ้ำไม่พบข้อมูลเหลือ";
    } else if (tool === "resize-a4") {
      bytes = await resizeToA4(base);
      const offSize = (await readPageSizes(bytes)).some(
        (size) => Math.abs(Math.min(size.width, size.height) - A4_SHORT_EDGE) > 1 || Math.abs(Math.max(size.width, size.height) - A4_LONG_EDGE) > 1,
      );
      if (offSize) throw new Error("บางหน้ายังไม่เป็นขนาด A4 ระบบจึงหยุดดาวน์โหลดเพื่อความปลอดภัย");
      note = `ปรับครบ ${pages.length} หน้าเป็น A4 แล้ว และตรวจขนาดทุกหน้าแล้ว`;
    } else {
      bytes = await nUp(base, toolOptions.perSheet);
      expectedPages = sheetCount(pages.length, toolOptions.perSheet);
      note = `${pages.length} หน้าจัดลง ${expectedPages} แผ่น แผ่นละ ${toolOptions.perSheet} หน้า`;
    }

    await verifyPdfPageCount(bytes, expectedPages);
    setDownloadResult(new Blob([bytes as BlobPart], { type: "application/pdf" }), `จัดแจง-${toolById(tool).label}.pdf`, "pdf", note, expectedPages);
  }

  async function installApp() {
    const prompt = installPrompt;
    if (!prompt) return;
    // A prompt can only be shown once.
    setInstallPrompt(null);
    await prompt.prompt().catch(() => undefined);
  }

  function toggleGameMode(on: boolean) {
    writeGameMode(globalThis.localStorage, on);
    window.dispatchEvent(new Event(GAME_MODE_CHANGE_EVENT));
  }

  function dismissInstall() {
    setInstallDismissed(true);
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // Blocked storage: it stays dismissed for this visit, which is enough.
    }
  }

  // Only read once a result exists, which never happens during server render.
  const install = result
    ? installHint({
        standalone:
          window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true,
        canPrompt: installPrompt !== null,
        iosBrowser: isIosBrowser(navigator.userAgent, navigator.maxTouchPoints),
        dismissed: installDismissed || readInstallDismissed(),
      })
    : "none";

  function selectTool(toolId: ToolId, options?: { revealWorkspace?: boolean }) {
    setActiveTool(toolId);
    setResult(null);
    setOnToolPage(true);
    // The address follows the tool, so what is in the bar can be shared as is.
    window.history.replaceState(null, "", toolPath(toolId));
    document.title = `${toolById(toolId).title} | จัดแจง`;
    if (options?.revealWorkspace) {
      workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /**
   * Arrow, Home and End move between tools the way the WAI-ARIA tabs pattern
   * expects. Selection follows focus, and the page is left where it is so
   * stepping through the list does not scroll the tabs out of view.
   */
  function handleToolKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = visibleTools.findIndex((tool) => tool.id === activeTool);
    const targetIndex = nextToolIndex(event.key, Math.max(0, currentIndex), visibleTools.length);
    if (targetIndex === null) {
      return;
    }

    event.preventDefault();
    const targetTool = visibleTools[targetIndex];
    selectTool(targetTool.id);
    toolListRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tool="${targetTool.id}"]`)
      ?.focus();
  }

  // ---------- #7: what the always-present live regions should say ----------
  const politeAnnouncement = useMemo(() => {
    if (result) return `ไฟล์พร้อมดาวน์โหลดแล้ว ${result.name} ${result.note}`;
    if (warning) return warning;
    if (isBusy) return "กำลังประมวลผลเอกสาร กรุณารอสักครู่";
    return "";
  }, [isBusy, result, warning]);

  const primaryAction = useMemo(() => {
    if (activeTool === "split") return `แยก ${selectedIds.size} หน้าที่เลือก`;
    if (activeTool === "compress") return "บีบอัดและตรวจผลลัพธ์";
    if (activeTool === "convert") return hasPdf ? `แปลงเป็น ${convertFormat.toUpperCase()}` : "สร้าง PDF จากรูป";
    if (activeTool === "merge") return "รวมเป็น PDF เดียว";
    if (activeTool === "page-numbers") return "ใส่เลขหน้า";
    if (activeTool === "watermark") return "ใส่ลายน้ำ";
    if (activeTool === "sign") return "วางลายเซ็น";
    if (activeTool === "redact") return redaction.marks ? `ปิดทึบ ${redaction.marks} จุด` : "ลากกรอบก่อนปิดทึบ";
    if (activeTool === "strip-metadata") return "ลบข้อมูลแฝง";
    if (activeTool === "resize-a4") return "ปรับเป็น A4";
    if (activeTool === "n-up") return `จัด ${toolOptions.perSheet} หน้าต่อแผ่น`;
    if (activeTool === "image-compress") return pages.length > 1 ? `ย่อ ${pages.length} รูป` : "ย่อรูป";
    return "สร้าง PDF พร้อมส่ง";
  }, [activeTool, convertFormat, hasPdf, selectedIds.size, redaction.marks, toolOptions.perSheet, pages.length]);

  return (
    <main className="app-shell" id="top">
      <div className="live-announcer" role="alert" aria-live="assertive">{error ?? ""}</div>
      <div className="live-announcer" role="status" aria-live="polite">{politeAnnouncement}</div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="จัดแจง หน้าหลัก">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/icon.svg" alt="" width={40} height={40} />
          <span>จัดแจง</span>
        </a>
        <div className="header-tools">
          <div className="trust-pill"><span className="status-dot" />ไฟล์ไม่ออกจากอุปกรณ์</div>
          <ThemeSwitcher />
        </div>
      </header>

      <section className="tools-section" aria-labelledby="tools-title">
        <div className="tools-heading">
          <div>
            <p className="section-label">PDF Tools · {TOOLS.length} เครื่องมือ</p>
            <h1 id="tools-title">{onToolPage ? activeToolOption.label : "เลือกสิ่งที่ต้องการทำ"}</h1>
          </div>
          <p>{onToolPage ? `${activeToolOption.detail} ทำงานบนอุปกรณ์ของคุณ ไม่ต้องอัปโหลดไฟล์` : "เลือกเครื่องมือ แล้วอัปโหลดไฟล์เพื่อดู Preview และจัดการต่อได้ทันที"}</p>
        </div>
        <div className="tool-filter" role="group" aria-label="กรองเครื่องมือตามหมวด">
          {TOOL_CATEGORIES.map((entry) => (
            <button key={entry.id} type="button" className="tool-filter-chip" aria-pressed={category === entry.id} onClick={() => setCategory(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
        <div
          className="tool-grid"
          role="tablist"
          aria-label="เลือกเครื่องมือ PDF"
          aria-orientation="horizontal"
          ref={toolListRef}
        >
          {visibleTools.map((tool) => (
            <button
              key={tool.id}
              id={`tool-tab-${tool.id}`}
              type="button"
              role="tab"
              aria-selected={activeTool === tool.id}
              aria-controls="quick-preview"
              tabIndex={activeTool === tool.id ? 0 : -1}
              data-tool={tool.id}
              data-palette={tool.palette}
              className={`tool-card ${activeTool === tool.id ? "active" : ""}`}
              onClick={() => selectTool(tool.id, { revealWorkspace: true })}
              onKeyDown={handleToolKeyDown}
            >
              <span className="tool-icon-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={tool.icon} alt="" aria-hidden="true" />
              </span>
              <span className="tool-card-copy"><strong>{tool.label}</strong><small>{tool.detail}</small></span>
              <span className="tool-arrow" aria-hidden="true">↘</span>
            </button>
          ))}
        </div>
        <nav className="tool-links" aria-label="หน้าของแต่ละเครื่องมือ">
          {TOOLS.map((tool) => <a key={tool.id} href={toolPath(tool.id)}>{tool.label}</a>)}
        </nav>
      </section>

      {(error || warning) && (
        <section className="notice-wrap">
          {error && <div className="notice error-notice"><div><strong>ทำรายการต่อไม่ได้</strong><p>{error}</p></div><button type="button" onClick={() => setError(null)} aria-label="ปิดข้อความผิดพลาด">ปิด</button></div>}
          {warning && <div className="notice warning-notice"><div><strong>โหมดไฟล์ขนาดใหญ่</strong><p>{warning}</p></div><button type="button" onClick={() => setWarning(null)} aria-label="ปิดคำเตือน">รับทราบ</button></div>}
        </section>
      )}

      <section
        className="workspace-section"
        id="quick-preview"
        role="tabpanel"
        ref={workspaceRef}
        data-active-tool={activeTool}
        data-palette={activeToolOption.palette}
        data-dragging={isDragging ? "true" : undefined}
        aria-labelledby="workspace-title"
        onDragEnter={handleDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="workspace-heading">
          <div className="active-tool-heading">
            <span className="active-tool-icon" key={activeTool}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={activeToolOption.icon} alt="" aria-hidden="true" />
            </span>
            <div><p className="section-label">Quick Preview</p><h2 id="workspace-title">{activeToolOption.label}</h2><p>{activeToolOption.detail}</p></div>
          </div>
          {pages.length > 0 && (
            <div className="workspace-actions">
              <label className="add-file-button" htmlFor="add-more-files">＋ เพิ่มไฟล์<input id="add-more-files" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple onChange={handleInput} disabled={isBusy} /></label>
              <button className="clear-button" type="button" onClick={() => void clearWorkspace()} disabled={isBusy}>ล้างไฟล์</button>
            </div>
          )}
        </div>

        {!pages.length ? (
          <div className="quick-preview-empty">
            <div className="empty-preview-copy">
              <div className="preview-flow-heading"><span>3 ขั้นตอน</span><h3>จากไฟล์ต้นฉบับ<br />ถึงไฟล์พร้อมส่ง</h3></div>
              <ol className="preview-steps">
                <li><span className="step-number">01</span><div><strong>เลือกไฟล์</strong><p>อ่านไฟล์และสร้าง Preview บนอุปกรณ์นี้</p></div></li>
                <li><span className="step-number">02</span><div><strong>ตรวจและจัดการ</strong><p>ดูหน้าเอกสารและตั้งค่าเครื่องมือที่เลือก</p></div></li>
                <li><span className="step-number">03</span><div><strong>ดาวน์โหลด</strong><p>ตรวจผลลัพธ์อัตโนมัติก่อนดาวน์โหลด</p></div></li>
              </ol>
              <p className="flow-privacy"><span className="status-dot" />ทำงานบนอุปกรณ์ของคุณ · เพิ่มไฟล์แล้วปิด Wi‑Fi ก็ยังทำต่อได้</p>
            </div>
            <div className="upload-card">
              <label className={`drop-zone ${isDragging ? "dragging" : ""}`} htmlFor="pdf-upload">
                {gameMode ? <Hoop ref={hoopRef} /> : <span className="upload-symbol">＋</span>}<strong>{gameMode ? "โยนไฟล์ลงห่วงได้เลย" : "วาง PDF หรือรูปที่นี่"}</strong><span>รองรับ PDF, JPG และ PNG · สูงสุด 150 MB ต่อครั้ง</span><span>ไม่ต้องสมัคร · ไม่มีลายน้ำ · ใช้ได้ไม่จำกัดครั้ง</span><span className="primary-button">เลือกไฟล์</span>
                <input id="pdf-upload" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple onChange={handleInput} disabled={isBusy} />
              </label>
              <label className="game-toggle">
                <input type="checkbox" role="switch" checked={gameMode} onChange={(event) => toggleGameMode(event.target.checked)} />
                <span>🏀 โหมดเกม: โยนไฟล์ลงห่วง</span>
              </label>
            </div>
          </div>
        ) : (
          <div className="workspace-grid">
            <aside className="settings-panel">
              <div className="settings-topline"><span>ตั้งค่าผลลัพธ์</span><span>Local</span></div>
              <h3>{activeToolOption.label}</h3>
              {activeTool === "compress" && (
                <>
                  <fieldset className="option-group">
                    <legend>ระดับการบีบอัด</legend>
                    {(Object.keys(COMPRESSION_SETTINGS) as CompressionLevel[]).map((level) => (
                      <label
                        key={level}
                        htmlFor={`compression-${level}`}
                        aria-label={`เลือกระดับ ${COMPRESSION_SETTINGS[level].label}`}
                        className={compressionLevel === level ? "selected" : ""}
                      >
                        <input
                          id={`compression-${level}`}
                          type="radio"
                          name="compression"
                          checked={compressionLevel === level}
                          onChange={() => setCompressionLevel(level)}
                        />
                        <span><strong>{COMPRESSION_SETTINGS[level].label}</strong><small>{level === "small" ? "เหมาะกับการส่งแบบฟอร์ม" : level === "balanced" ? "แนะนำสำหรับงานทั่วไป" : "เหมาะกับเอกสารภาพ"}</small></span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="flatten-warning">โหมดนี้แปลงแต่ละหน้าเป็นภาพเพื่อให้ไฟล์เล็กลง จึงค้นหาหรือเลือกข้อความเดิมไม่ได้</p>
                </>
              )}
              {activeTool === "convert" && hasPdf && (
                <fieldset className="option-group inline-options">
                  <legend>รูปแบบภาพ</legend>
                  {(["jpg", "png"] as ImageFormat[]).map((format) => (
                    <label key={format} htmlFor={`convert-${format}`} className={convertFormat === format ? "selected" : ""}>
                      <input id={`convert-${format}`} type="radio" name="convert" checked={convertFormat === format} onChange={() => setImageFormat(format)} />
                      <strong>{format.toUpperCase()}</strong>
                    </label>
                  ))}
                </fieldset>
              )}
              {activeTool === "split" && (
                <div className="selection-summary">
                  <span>{selectedIds.size}</span>
                  <p>หน้าที่เลือกจากทั้งหมด {pages.length} หน้า</p>
                  <button type="button" onClick={() => setSelectedIds(selectedIds.size === pages.length ? new Set() : new Set(pages.map((page) => page.id)))}>
                    {selectedIds.size === pages.length ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
                  </button>
                </div>
              )}
              {(activeTool === "organize" || activeTool === "merge") && (
                <div className="settings-copy">
                  <p>ใช้ปุ่มใต้ Preview เพื่อเลื่อน หมุน หรือลบหน้า ระบบจะสร้างผลลัพธ์ตามลำดับที่เห็น</p>
                  <dl><div><dt>ไฟล์ต้นฉบับ</dt><dd>{sources.length}</dd></div><div><dt>หน้าผลลัพธ์</dt><dd>{pages.length}</dd></div></dl>
                </div>
              )}
              {activeTool === "convert" && onlyImages && (
                <div className="settings-copy"><p>รูปทุกใบจะถูกจัดวางกลางหน้ากระดาษ A4 โดยรักษาสัดส่วนเดิม</p></div>
              )}
              <ToolSettings
                tool={activeTool}
                options={toolOptions}
                setOption={setOption}
                pageCount={pages.length}
                hasPdf={hasPdf}
                hasImages={hasImages}
                watermarkImage={watermarkImage}
                onWatermarkImage={(file) => void chooseWatermarkImage(file)}
                signature={signature}
                onSignature={(stamp) => { replaceStamp(setSignature, stamp); setResult(null); }}
                redaction={redaction}
                onClearRedactions={() => { setRedactions({}); setResult(null); }}
                metadata={metadata?.key === metadataKey ? metadata.entries : null}
              />
              <div className="quality-caution">
                <span>ตรวจอัตโนมัติ</span>
                <p>ระบบจะเปิดผลลัพธ์ซ้ำเพื่อตรวจจำนวนหน้าก่อนให้ดาวน์โหลด</p>
              </div>
              <button className="process-button" type="button" onClick={() => void processDocument()} disabled={isBusy || !pages.length}>
                {isBusy ? "กำลังประมวลผล…" : primaryAction} <span>→</span>
              </button>
            </aside>

            <div className="page-manager">
              <div className="manager-topbar">
                <div><strong>Preview เอกสาร</strong><span>{pages.length} หน้า · {formatBytes(totalInputSize)}</span></div>
                <p><span className="status-dot" /> อยู่ในอุปกรณ์</p>
              </div>
              <div className="page-grid" role="list" aria-label="หน้าทั้งหมด">
                {pages.map((page, index) => {
                  const state = previewState(page);
                  const isError = state === "error";
                  return (
                  <article
                    key={page.id}
                    role="listitem"
                    className={`page-card ${currentPage?.id === page.id ? "current" : ""}`}
                  >
                    <div className="page-card-top">
                      {activeTool === "split" ? (
                        <label htmlFor={`split-page-${page.id}`}>
                          <input id={`split-page-${page.id}`} type="checkbox" checked={selectedIds.has(page.id)} onChange={() => toggleSelected(page.id)} />
                          <span>{selectedIds.has(page.id) ? "เลือกแล้ว" : "เลือก"}</span>
                        </label>
                      ) : <span>หน้า {index + 1}</span>}
                      <small>{page.fileName}</small>
                    </div>
                    <button
                      className={`thumb-frame thumb-frame--${state}`}
                      type="button"
                      onClick={(event) => {
                        if (isError) {
                          retryPreview(page);
                          return;
                        }
                        setCurrentPageId(page.id);
                        openDetail(page.id, event.currentTarget);
                      }}
                      aria-busy={state === "loading" || undefined}
                      aria-label={
                        isError
                          ? `สร้าง Preview หน้า ${index + 1} ไม่สำเร็จ ลองใหม่`
                          : state === "unavailable"
                            ? `ดูหน้า ${index + 1} แบบเต็มจอ ยังไม่มี Preview ${unavailableReason()}`
                            : `ดูหน้า ${index + 1} แบบเต็มจอ`
                      }
                    >
                      {state === "ready" && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={page.previewUrl}
                          alt=""
                          style={{ transform: `rotate(${page.rotation}deg)` }}
                        />
                      )}

                      {state === "loading" && (
                        <span className="thumb-state">
                          <span className="thumb-skeleton" aria-hidden="true">
                            <span /><span /><span /><span />
                          </span>
                          <span className="thumb-status">กำลังสร้าง Preview…</span>
                        </span>
                      )}

                      {state === "unavailable" && (
                        <span className="thumb-state thumb-state--unavailable">
                          <strong className="thumb-large-number" aria-hidden="true">{page.pageNumber}</strong>
                          <span className="thumb-state-title">ยังไม่มี Preview</span>
                          <span className="thumb-state-description">{unavailableReason()}</span>
                        </span>
                      )}

                      {isError && (
                        <span className="thumb-state thumb-state--error">
                          <span className="thumb-error-mark" aria-hidden="true">!</span>
                          <span className="thumb-state-title">สร้าง Preview ไม่สำเร็จ</span>
                          <span className="thumb-state-description">ไฟล์อาจเสียหาย หรือหน่วยความจำไม่พอ</span>
                          <span className="thumb-retry">ลองใหม่</span>
                        </span>
                      )}
                    </button>
                    <div className="page-controls">
                      <button type="button" onClick={() => reorderPage(index, -1)} disabled={index === 0 || isBusy} aria-label={`เลื่อนหน้า ${index + 1} ไปซ้าย`}>←</button>
                      <button type="button" onClick={() => rotatePage(page)} disabled={isBusy} aria-label={`หมุนหน้า ${index + 1}`}>↻</button>
                      <button type="button" onClick={() => reorderPage(index, 1)} disabled={index === pages.length - 1 || isBusy} aria-label={`เลื่อนหน้า ${index + 1} ไปขวา`}>→</button>
                      <button className="delete-page" type="button" onClick={() => removePage(page.id)} disabled={isBusy} aria-label={`ลบหน้า ${index + 1}`}>×</button>
                    </div>
                  </article>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {progress && (
          <div className="progress-box">
            <div><span>{progress.label}</span><strong>{progress.percent}%</strong></div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label={progress.label}
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}
        <p className="privacy-note"><span className="lock-symbol">●</span>ประมวลผลในเบราว์เซอร์ ไม่มีการส่งไฟล์ขึ้นเซิร์ฟเวอร์</p>
        <p className="usage-note">นับเฉพาะสถิติการใช้งานแบบรวม เช่น ใช้เครื่องมือไหนและสำเร็จหรือไม่ ไม่เก็บไฟล์ ชื่อไฟล์ หรือข้อมูลที่ระบุตัวคุณ</p>

        {result && (
          <div className="download-result" id="download-result">
            <div className="result-icon">✓</div>
            <div className="result-copy"><p>พร้อมดาวน์โหลด</p><h3>{result.name}</h3><span>{formatBytes(result.size)} · {result.note}</span></div>
            <a className="download-button" href={result.url} download={result.name} onClick={() => autoClear.schedule(() => void clearWorkspace())}>ดาวน์โหลดไฟล์ <span>↓</span></a>
            <button type="button" className="delete-now" onClick={() => void clearWorkspace()}>ดาวน์โหลดแล้ว ล้างไฟล์ทันที</button>
            <small className="auto-clear-note">ระบบจะล้างพื้นที่ทำงานอัตโนมัติภายใน {AUTO_CLEAR_DELAY_SECONDS} วินาทีหลังเริ่มดาวน์โหลด</small>
            {install !== "none" && (
              <div className="install-hint">
                <p>
                  {install === "prompt"
                    ? "ใช้บ่อยไหม? ติดตั้งจัดแจงไว้บนหน้าจอโฮม เปิดได้ในแตะเดียว"
                    : "ใช้บ่อยไหม? กดปุ่มแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”"}
                </p>
                {install === "prompt" && (
                  <button type="button" className="install-button" onClick={() => void installApp()}>ติดตั้ง</button>
                )}
                <button type="button" className="install-dismiss" onClick={dismissInstall}>ไม่ต้อง</button>
              </div>
            )}
          </div>
        )}
      </section>

      {detailPage && (
        <div
          className="detail-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`หน้า ${detailIndex + 1} จาก ${pages.length}`}
          ref={overlayRef}
        >
          <div className="detail-topbar">
            <div>
              <strong>หน้า {detailIndex + 1} จาก {pages.length}</strong>
              <span>{detailPage.fileName} · หน้าต้นฉบับ {detailPage.pageNumber}</span>
            </div>
            <button
              className="detail-close"
              type="button"
              ref={detailCloseRef}
              onClick={closeDetail}
            >
              ปิด <span aria-hidden="true">✕</span>
            </button>
          </div>

          <div className="detail-stage">
            <button
              className="detail-previous"
              type="button"
              onClick={() => stepDetail(-1)}
              disabled={detailIndex === 0}
              aria-label="หน้าก่อนหน้า"
            >
              <span aria-hidden="true">←</span>
            </button>

            <div className="detail-frame" ref={detailStageRef}>
              {detailImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="detail-image"
                    src={detailImage}
                    alt={`หน้า ${detailIndex + 1}`}
                    ref={detailImageRef}
                  />
                  {activeTool === "redact" && (
                    <RedactLayer
                      image={detailImageRef}
                      rects={redactions[detailPage.id] ?? []}
                      // A blurry stand-in may still be unrotated; boxes drawn on it would land wrong.
                      ready={detailIsCurrent}
                      onChange={(rects) => {
                        setRedactions((current) => ({ ...current, [detailPage.id]: rects }));
                        setResult(null);
                      }}
                    />
                  )}
                </>
              ) : (
                <p className="detail-empty">ยังไม่มีภาพสำหรับหน้านี้</p>
              )}
              {isSharpening && (
                <p className="detail-status" role="status">กำลังเตรียมภาพคมชัด…</p>
              )}
            </div>

            <button
              className="detail-next"
              type="button"
              onClick={() => stepDetail(1)}
              disabled={detailIndex === pages.length - 1}
              aria-label="หน้าถัดไป"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * Drag to add a box; each box has its own remove button, which is also how a
 * keyboard user takes one back out.
 */
function RedactLayer({ image, rects, ready, onChange }: {
  image: RefObject<HTMLImageElement | null>;
  rects: NormalizedRect[];
  ready: boolean;
  onChange: (rects: NormalizedRect[]) => void;
}) {
  const [draft, setDraft] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [frame, setFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const element = image.current;
    if (!element) return;
    // Sits exactly over the picture, wherever the frame centred it.
    const measure = () =>
      setFrame({ left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("load", measure);
    return () => {
      observer.disconnect();
      element.removeEventListener("load", measure);
    };
  }, [image]);

  function local(event: ReactPointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draft) return;
    const box = event.currentTarget.getBoundingClientRect();
    const rect = dragToRect(draft.start, local(event), { width: box.width, height: box.height });
    setDraft(null);
    if (rect) onChange([...rects, rect]);
  }

  const style = (rect: NormalizedRect) => ({
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  });

  return (
    <div
      className={`redact-layer ${ready ? "" : "waiting"}`}
      style={frame ?? { display: "none" }}
      onPointerDown={(event) => {
        if (!ready || event.target !== event.currentTarget) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = local(event);
        setDraft({ start: point, end: point });
      }}
      onPointerMove={(event) => draft && setDraft({ ...draft, end: local(event) })}
      onPointerUp={finish}
      onPointerCancel={() => setDraft(null)}
    >
      {rects.map((rect, index) => (
        <div key={index} className="redact-box" style={style(rect)}>
          <button type="button" className="redact-remove" aria-label={`เอากรอบที่ ${index + 1} ออก`} onClick={() => onChange(rects.filter((_, other) => other !== index))}>×</button>
        </div>
      ))}
      {draft && (
        <div
          className="redact-box draft"
          style={{
            left: Math.min(draft.start.x, draft.end.x),
            top: Math.min(draft.start.y, draft.end.y),
            width: Math.abs(draft.end.x - draft.start.x),
            height: Math.abs(draft.end.y - draft.start.y),
          }}
        />
      )}
      {!ready && <p className="redact-hint">รอภาพคมชัดก่อน แล้วค่อยลากกรอบ</p>}
      {ready && !rects.length && !draft && <p className="redact-hint">ลากกรอบทับข้อมูลที่ต้องการปิด</p>}
    </div>
  );
}

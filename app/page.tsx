"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  MAX_PAGES,
  buildPdf,
  findOrphanedSourceIds,
  formatBytes,
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
import { verifyArchiveEntryCount, type ImageFormat } from "./lib/verify-output";
import {
  COMPRESSION_SETTINGS,
  buildCompressedPdf,
  buildImageArchive,
  type CompressionLevel,
  type OutputBuilderDeps,
} from "./lib/output-builder";
import { nextToolIndex } from "./lib/tool-navigation";
import { canvasToBlob, createPageRenderer } from "./lib/page-renderer";

type ToolId = "organize" | "merge" | "split" | "compress" | "convert";

type WorkspacePage = PageRecord & {
  fileName: string;
  previewUrl?: string;
};

type ResultFile = {
  name: string;
  url: string;
  size: number;
  type: "pdf" | "zip";
  note: string;
  pageCount: number;
};

type ProgressState = {
  label: string;
  percent: number;
};

const toolOptions: Array<{ id: ToolId; label: string; detail: string; icon: string }> = [
  { id: "organize", label: "จัดหน้า PDF", detail: "เรียง หมุน หรือลบหน้าให้พร้อมส่ง", icon: "/tool-icons/organize.png" },
  { id: "merge", label: "รวม PDF", detail: "รวมหลายไฟล์ตามลำดับเป็นไฟล์เดียว", icon: "/tool-icons/merge.png" },
  { id: "split", label: "แยกหน้า PDF", detail: "เลือกหน้าและดาวน์โหลดเป็น PDF หรือ ZIP", icon: "/tool-icons/split.png" },
  { id: "compress", label: "บีบอัด PDF", detail: "ลดขนาดเอกสารภาพด้วยระดับที่เลือกได้", icon: "/tool-icons/compress.png" },
  { id: "convert", label: "แปลงไฟล์", detail: "PDF เป็น JPG / PNG หรือรูปภาพเป็น PDF", icon: "/tool-icons/convert.png" },
];

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

export default function Home() {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [pages, setPages] = useState<WorkspacePage[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>("organize");
  const [compressionLevel, setCompressionLevel] = useState<CompressionLevel>("balanced");
  const [convertFormat, setImageFormat] = useState<ImageFormat>("jpg");
  const [result, setResult] = useState<ResultFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const workspaceRef = useRef<HTMLElement | null>(null);
  const toolListRef = useRef<HTMLDivElement | null>(null);
  const resultUrl = useRef<string | null>(null);
  const [renderer] = useState(() => createPageRenderer({ pdfWorkerSrc: pdfWorkerUrl }));
  const [autoClear] = useState<AutoClearTimer>(() => createAutoClearTimer());

  const totalInputSize = useMemo(
    () => sources.reduce((sum, source) => sum + source.size, 0),
    [sources],
  );
  const hasPdf = sources.some((source) => source.type === "pdf");
  const onlyImages = sources.length > 0 && sources.every((source) => source.type !== "pdf");
  const currentPage = pages.find((page) => page.id === currentPageId) ?? pages[0];
  const activeToolOption = toolOptions.find((tool) => tool.id === activeTool) ?? toolOptions[0];

  async function clearWorkspace() {
    autoClear.cancel();
    renderer.releaseAll();
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
    setSources([]);
    setPages([]);
    setSelectedIds(new Set());
    setCurrentPageId(null);
    setResult(null);
    setError(null);
    setWarning(null);
    setProgress(null);
    setActiveTool("organize");
  }

  useEffect(() => {
    return () => {
      autoClear.cancel();
      renderer.releaseAll();
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    };
  }, [autoClear, renderer]);

  useEffect(() => {
    if (!currentPage || currentPage.previewUrl) return;
    const source = sources.find((item) => item.id === currentPage.sourceId);
    if (!source) return;
    let cancelled = false;
    renderer.createPreview(source, currentPage)
      .then((url) => {
        if (!cancelled) {
          setPages((items) =>
            items.map((item) => (item.id === currentPage.id ? { ...item, previewUrl: url } : item)),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Rendering is intentionally keyed to the active page only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId]);

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
        const source: SourceRecord = { id, name: file.name, size: file.size, type, bytes };
        newSources.push(source);

        if (type === "pdf") {
          const document = await renderer.loadDocument(source);
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
            if (newPages.length < 36) {
              page.previewUrl = await renderer.createPreview(source, page);
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
      if (newSources.every((source) => source.type !== "pdf") && !hasPdf) setActiveTool("convert");
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
    if (files.length) void addFiles(files);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (!isBusy) void addFiles(Array.from(event.dataTransfer.files));
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
    setSelectedIds((items) => {
      const next = new Set(items);
      next.delete(id);
      return next;
    });
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
        const selected = pages.filter((page) => selectedIds.has(page.id));
        if (!selected.length) throw new Error("กรุณาเลือกหน้าที่ต้องการแยกอย่างน้อย 1 หน้า");
        if (selected.length === 1) {
          const bytes = await buildPdf(sources, selected);
          await verifyPdfPageCount(bytes, 1);
          setDownloadResult(
            new Blob([bytes as BlobPart], { type: "application/pdf" }),
            "จัดแจง-หน้าที่เลือก.pdf",
            "pdf",
            "ตรวจสอบแล้ว: ผลลัพธ์มี 1 หน้าตามที่เลือก",
            1,
          );
        } else {
          const files = await splitPdfPages(sources, selected);
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
      } else if (activeTool === "compress") {
        const bytes = await buildCompressedPdf(pages, compressionLevel, outputDeps);
        await verifyPdfPageCount(bytes, pages.length);
        const difference = totalInputSize - bytes.length;
        const note =
          difference > 0
            ? `ลดลง ${Math.max(1, Math.round((difference / totalInputSize) * 100))}% และตรวจครบ ${pages.length} หน้า`
            : `ไฟล์ใหม่ไม่เล็กลง แต่ตรวจครบ ${pages.length} หน้า — ลองระดับ “ไฟล์เล็ก” เพื่อผลที่ดีกว่า`;
        setDownloadResult(
          new Blob([bytes as BlobPart], { type: "application/pdf" }),
          "จัดแจง-บีบอัด.pdf",
          "pdf",
          note,
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
      window.setTimeout(() => {
        setProgress(null);
        document.getElementById("download-result")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    } catch (caught) {
      setError(friendlyError(caught));
      setProgress(null);
    } finally {
      setIsBusy(false);
    }
  }

  function selectTool(toolId: ToolId, options?: { revealWorkspace?: boolean }) {
    setActiveTool(toolId);
    setResult(null);
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
    const currentIndex = toolOptions.findIndex((tool) => tool.id === activeTool);
    const targetIndex = nextToolIndex(event.key, currentIndex, toolOptions.length);
    if (targetIndex === null) {
      return;
    }

    event.preventDefault();
    const targetTool = toolOptions[targetIndex];
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
    return "สร้าง PDF พร้อมส่ง";
  }, [activeTool, convertFormat, hasPdf, selectedIds.size]);

  return (
    <main className="app-shell" id="top">
      <div className="live-announcer" role="alert" aria-live="assertive">{error ?? ""}</div>
      <div className="live-announcer" role="status" aria-live="polite">{politeAnnouncement}</div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="จัดแจง หน้าหลัก">
          <span className="brand-mark">จ</span>
          <span>จัดแจง</span>
        </a>
        <div className="trust-pill"><span className="status-dot" />ไฟล์ไม่ออกจากอุปกรณ์</div>
      </header>

      <section className="tools-section" aria-labelledby="tools-title">
        <div className="tools-heading">
          <div>
            <p className="section-label">PDF Tools</p>
            <h1 id="tools-title">เลือกสิ่งที่ต้องการทำ</h1>
          </div>
          <p>เลือกเครื่องมือ แล้วอัปโหลดไฟล์เพื่อดู Preview และจัดการต่อได้ทันที</p>
        </div>
        <div
          className="tool-grid"
          role="tablist"
          aria-label="เลือกเครื่องมือ PDF"
          aria-orientation="horizontal"
          ref={toolListRef}
        >
          {toolOptions.map((tool) => (
            <button
              key={tool.id}
              id={`tool-tab-${tool.id}`}
              type="button"
              role="tab"
              aria-selected={activeTool === tool.id}
              aria-controls="quick-preview"
              tabIndex={activeTool === tool.id ? 0 : -1}
              data-tool={tool.id}
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
      </section>

      {(error || warning) && (
        <section className="notice-wrap">
          {error && <div className="notice error-notice"><div><strong>ทำรายการต่อไม่ได้</strong><p>{error}</p></div><button type="button" onClick={() => setError(null)} aria-label="ปิดข้อความผิดพลาด">ปิด</button></div>}
          {warning && <div className="notice warning-notice"><div><strong>โหมดไฟล์ขนาดใหญ่</strong><p>{warning}</p></div><button type="button" onClick={() => setWarning(null)} aria-label="ปิดคำเตือน">รับทราบ</button></div>}
        </section>
      )}

      <section className="workspace-section" id="quick-preview" role="tabpanel" ref={workspaceRef} data-active-tool={activeTool} aria-labelledby="workspace-title">
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
              <p className="flow-privacy"><span className="status-dot" />ทำงานบนอุปกรณ์ของคุณ</p>
            </div>
            <div className="upload-card">
              <label className={`drop-zone ${isDragging ? "dragging" : ""}`} htmlFor="pdf-upload" onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}>
                <span className="upload-symbol">＋</span><strong>วาง PDF หรือรูปที่นี่</strong><span>รองรับ PDF, JPG และ PNG · สูงสุด 150 MB ต่อครั้ง</span><span className="primary-button">เลือกไฟล์</span>
                <input id="pdf-upload" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple onChange={handleInput} disabled={isBusy} />
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
              <div className="preview-layout">
                <div className="main-preview">
                  <div className="paper-preview">
                    {currentPage?.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={currentPage.previewUrl}
                        alt={`Preview หน้า ${pages.findIndex((page) => page.id === currentPage.id) + 1}`}
                        style={{ transform: `rotate(${currentPage.rotation}deg)` }}
                      />
                    ) : (
                      <div className="preview-placeholder"><span>{currentPage?.pageNumber ?? "–"}</span><p>แตะหน้านี้เพื่อสร้าง Preview</p></div>
                    )}
                  </div>
                  <p>{currentPage?.fileName} · หน้าต้นฉบับ {currentPage?.pageNumber}</p>
                </div>

                <div className="page-grid" role="list" aria-label="หน้าทั้งหมด">
                  {pages.map((page, index) => (
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
                        className="thumb-frame"
                        type="button"
                        onClick={() => setCurrentPageId(page.id)}
                        aria-label={`แสดง Preview หน้า ${index + 1}`}
                      >
                        {page.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={page.previewUrl}
                            alt=""
                            style={{ transform: `rotate(${page.rotation}deg)` }}
                          />
                        ) : <span>{page.pageNumber}</span>}
                      </button>
                      <div className="page-controls">
                        <button type="button" onClick={() => reorderPage(index, -1)} disabled={index === 0 || isBusy} aria-label={`เลื่อนหน้า ${index + 1} ไปซ้าย`}>←</button>
                        <button type="button" onClick={() => updatePage(page.id, { rotation: (page.rotation + 90) % 360 })} disabled={isBusy} aria-label={`หมุนหน้า ${index + 1}`}>↻</button>
                        <button type="button" onClick={() => reorderPage(index, 1)} disabled={index === pages.length - 1 || isBusy} aria-label={`เลื่อนหน้า ${index + 1} ไปขวา`}>→</button>
                        <button className="delete-page" type="button" onClick={() => removePage(page.id)} disabled={isBusy} aria-label={`ลบหน้า ${index + 1}`}>×</button>
                      </div>
                    </article>
                  ))}
                </div>
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

        {result && (
          <div className="download-result" id="download-result">
            <div className="result-icon">✓</div>
            <div className="result-copy"><p>พร้อมดาวน์โหลด</p><h3>{result.name}</h3><span>{formatBytes(result.size)} · {result.note}</span></div>
            <a className="download-button" href={result.url} download={result.name} onClick={() => autoClear.schedule(() => void clearWorkspace())}>ดาวน์โหลดไฟล์ <span>↓</span></a>
            <button type="button" className="delete-now" onClick={() => void clearWorkspace()}>ดาวน์โหลดแล้ว ล้างไฟล์ทันที</button>
            <small className="auto-clear-note">ระบบจะล้างพื้นที่ทำงานอัตโนมัติภายใน {AUTO_CLEAR_DELAY_SECONDS} วินาทีหลังเริ่มดาวน์โหลด</small>
          </div>
        )}
      </section>
    </main>
  );
}

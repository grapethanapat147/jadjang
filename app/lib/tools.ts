/**
 * Every tool the workspace offers, in one place: the card, its colour, the
 * page it gets at its own URL, and what it accepts.
 *
 * Slugs are ASCII on purpose. A Thai path is percent-encoded into an
 * unreadable string wherever it is pasted; the Thai words people search for
 * live in each page's title and heading instead.
 */

export type ToolId =
  | "organize"
  | "merge"
  | "split"
  | "compress"
  | "convert"
  | "page-numbers"
  | "watermark"
  | "sign"
  | "redact"
  | "strip-metadata"
  | "resize-a4"
  | "n-up"
  | "image-compress";

export type ToolCategory = "pages" | "edit" | "privacy" | "size";

/** A colour set in globals.css (--{palette}-accent and friends). */
export type ToolPalette = "organize" | "merge" | "split" | "compress" | "convert" | "annotate" | "layout" | "privacy";

export type ToolDefinition = {
  id: ToolId;
  slug: string;
  label: string;
  detail: string;
  icon: string;
  category: ToolCategory;
  palette: ToolPalette;
  /** What a search result shows: the Thai words someone would type. */
  title: string;
  description: string;
  /** "images" tools refuse PDFs; everything else takes PDFs and images alike. */
  accepts: "documents" | "images";
};

export const TOOL_CATEGORIES: ReadonlyArray<{ id: ToolCategory | "all"; label: string }> = [
  { id: "all", label: "ทั้งหมด" },
  { id: "pages", label: "จัดหน้าและรวมไฟล์" },
  { id: "edit", label: "ใส่เลขหน้าและลงชื่อ" },
  { id: "privacy", label: "ความเป็นส่วนตัว" },
  { id: "size", label: "ลดขนาดและแปลง" },
];

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: "organize", slug: "organize-pdf", label: "จัดหน้า PDF", detail: "เรียง หมุน หรือลบหน้าให้พร้อมส่ง",
    icon: "/tool-icons/organize.png", category: "pages", palette: "organize", accepts: "documents",
    title: "จัดหน้า PDF ออนไลน์ เรียง หมุน ลบหน้า ฟรี",
    description: "เรียงลำดับ หมุน หรือลบหน้า PDF บนอุปกรณ์ของคุณ ไม่ต้องอัปโหลดไฟล์ ไม่ต้องสมัคร",
  },
  {
    id: "merge", slug: "merge-pdf", label: "รวม PDF", detail: "รวมหลายไฟล์ตามลำดับเป็นไฟล์เดียว",
    icon: "/tool-icons/merge.png", category: "pages", palette: "merge", accepts: "documents",
    title: "รวมไฟล์ PDF เป็นไฟล์เดียว ฟรี ไม่ต้องอัปโหลด",
    description: "รวม PDF และรูปหลายไฟล์ให้เป็น PDF เดียวตามลำดับที่ต้องการ ทำงานในเบราว์เซอร์ทั้งหมด",
  },
  {
    id: "split", slug: "split-pdf", label: "แยกหน้า PDF", detail: "เลือกหน้าและดาวน์โหลดเป็น PDF หรือ ZIP",
    icon: "/tool-icons/split.png", category: "pages", palette: "split", accepts: "documents",
    title: "แยกหน้า PDF เลือกเฉพาะหน้าที่ต้องการ ฟรี",
    description: "เลือกหน้าจาก PDF แล้วดาวน์โหลดเป็นไฟล์ใหม่หรือ ZIP หน้าละไฟล์ โดยไฟล์ไม่ออกจากอุปกรณ์",
  },
  {
    id: "n-up", slug: "pages-per-sheet", label: "หลายหน้าในแผ่นเดียว", detail: "พิมพ์ 2 หรือ 4 หน้าลงกระดาษ A4 แผ่นเดียว",
    icon: "/tool-icons/n-up.svg", category: "pages", palette: "layout", accepts: "documents",
    title: "รวมหลายหน้า PDF ลงแผ่นเดียว 2 หน้า 4 หน้าต่อแผ่น",
    description: "จัด PDF ให้พิมพ์ 2 หรือ 4 หน้าต่อกระดาษ A4 หนึ่งแผ่น ประหยัดกระดาษ ทำงานบนอุปกรณ์ของคุณ",
  },
  {
    id: "resize-a4", slug: "resize-pdf-a4", label: "ปรับหน้าเป็น A4", detail: "ทำให้ทุกหน้าเป็นขนาด A4 เท่ากัน",
    icon: "/tool-icons/resize-a4.svg", category: "pages", palette: "layout", accepts: "documents",
    title: "ปรับขนาด PDF เป็น A4 ทุกหน้า ฟรี",
    description: "ย่อหรือขยายทุกหน้าของ PDF ให้เป็นกระดาษ A4 โดยไม่บิดสัดส่วน พร้อมพิมพ์และส่งงาน",
  },
  {
    id: "page-numbers", slug: "add-page-numbers", label: "ใส่เลขหน้า", detail: "เติมเลขหน้าที่มุมหรือกลางกระดาษ",
    icon: "/tool-icons/page-numbers.svg", category: "edit", palette: "annotate", accepts: "documents",
    title: "ใส่เลขหน้า PDF ออนไลน์ ฟรี ไม่ต้องอัปโหลด",
    description: "เติมเลขหน้าให้ PDF ที่ท้ายกระดาษหรือมุมขวาบน เลือกรูปแบบ 1 หรือ 1 / 10 ได้",
  },
  {
    id: "watermark", slug: "watermark-pdf", label: "ใส่ลายน้ำ", detail: "ข้อความภาษาไทยหรือโลโก้ทับทุกหน้า",
    icon: "/tool-icons/watermark.svg", category: "edit", palette: "annotate", accepts: "documents",
    title: "ใส่ลายน้ำ PDF ภาษาไทย เช่น สำเนาถูกต้อง ฟรี",
    description: "ใส่ลายน้ำข้อความภาษาไทยหรือโลโก้ลงทุกหน้าของ PDF เหมาะกับสำเนาบัตรและเอกสารส่งงาน",
  },
  {
    id: "sign", slug: "sign-pdf", label: "ลงลายเซ็น", detail: "วาดหรือใช้รูปลายเซ็นวางบนหน้าที่เลือก",
    icon: "/tool-icons/sign.svg", category: "edit", palette: "annotate", accepts: "documents",
    title: "เซ็นเอกสาร PDF ออนไลน์ วาดลายเซ็นได้ ฟรี",
    description: "วาดลายเซ็นหรือใช้รูปลายเซ็น แล้ววางลงบนหน้าที่เลือกของ PDF โดยไฟล์ไม่ออกจากอุปกรณ์",
  },
  {
    id: "redact", slug: "redact-pdf", label: "ปิดทึบข้อมูล", detail: "ลากกรอบปิดเลขบัตรหรือข้อมูลส่วนตัว",
    icon: "/tool-icons/redact.svg", category: "privacy", palette: "privacy", accepts: "documents",
    title: "ปิดทึบข้อมูลใน PDF ก่อนส่ง เช่น เลขบัตรประชาชน",
    description: "ลากกรอบปิดข้อมูลส่วนตัวใน PDF แบบลบออกจริง ไม่ใช่แค่วางกล่องดำทับ ทำงานบนอุปกรณ์ของคุณ",
  },
  {
    id: "strip-metadata", slug: "remove-pdf-metadata", label: "ลบข้อมูลแฝง", detail: "ลบชื่อผู้สร้างและข้อมูลที่ซ่อนในไฟล์",
    icon: "/tool-icons/strip-metadata.svg", category: "privacy", palette: "privacy", accepts: "documents",
    title: "ลบข้อมูลแฝงใน PDF ชื่อผู้เขียน โปรแกรมที่สร้าง",
    description: "ดูและลบข้อมูลที่ซ่อนอยู่ใน PDF เช่น ชื่อผู้เขียน โปรแกรมที่ใช้สร้าง และวันที่ ก่อนส่งไฟล์ให้คนอื่น",
  },
  {
    id: "compress", slug: "compress-pdf", label: "บีบอัด PDF", detail: "ลดขนาดเอกสารภาพด้วยระดับที่เลือกได้",
    icon: "/tool-icons/compress.png", category: "size", palette: "compress", accepts: "documents",
    title: "บีบอัด PDF ลดขนาดไฟล์ ฟรี ไม่ต้องอัปโหลด",
    description: "ลดขนาด PDF ให้ส่งอีเมลหรือแนบแบบฟอร์มได้ เลือกระดับความคมชัดเอง ทำงานในเบราว์เซอร์",
  },
  {
    id: "image-compress", slug: "compress-image", label: "ย่อรูป", detail: "ลดขนาดรูป JPG / PNG และลบข้อมูลตำแหน่ง",
    icon: "/tool-icons/image-compress.svg", category: "size", palette: "convert", accepts: "images",
    title: "ย่อขนาดรูป ลดขนาดไฟล์ JPG PNG ออนไลน์ ฟรี",
    description: "ย่อรูปและลดขนาดไฟล์ JPG / PNG ให้แนบง่าย พร้อมลบข้อมูลตำแหน่ง GPS ในรูป ไฟล์ไม่ออกจากอุปกรณ์",
  },
  {
    id: "convert", slug: "convert-pdf", label: "แปลงไฟล์", detail: "PDF เป็น JPG / PNG หรือรูปภาพเป็น PDF",
    icon: "/tool-icons/convert.png", category: "size", palette: "convert", accepts: "documents",
    title: "แปลง PDF เป็น JPG และแปลงรูปเป็น PDF ฟรี",
    description: "แปลงทุกหน้าของ PDF เป็นรูป JPG / PNG หรือรวมรูปเป็น PDF ขนาด A4 บนอุปกรณ์ของคุณ",
  },
];

export const DEFAULT_TOOL: ToolId = "organize";

export function toolById(id: ToolId): ToolDefinition {
  return TOOLS.find((tool) => tool.id === id) ?? TOOLS[0];
}

export function toolBySlug(slug: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}

export function toolPath(id: ToolId): string {
  return `/${toolById(id).slug}`;
}

/** The tool a path names, so a deep link opened offline still lands on its tool. */
export function toolFromPath(pathname: string): ToolId | null {
  return toolBySlug(decodeURIComponent(pathname).replace(/^\/+|\/+$/g, ""))?.id ?? null;
}

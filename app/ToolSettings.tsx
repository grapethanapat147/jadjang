import { SignaturePad } from "./SignaturePad";
import { IMAGE_COMPRESSION, type ImageCompressionLevel, type PngStamp } from "./lib/canvas-tools";
import type { MetadataEntry, NumberFormat, NumberPosition } from "./lib/pdf-tools";
import type { ToolId } from "./lib/tools";

export type SignSize = "small" | "medium" | "large";
export type SignCorner = "bottom-left" | "bottom-center" | "bottom-right";

export type ToolOptions = {
  numberPosition: NumberPosition;
  numberFormat: NumberFormat;
  watermarkKind: "text" | "image";
  watermarkText: string;
  watermarkPlacement: "diagonal" | "corner";
  /** 1-based; null means the last page, which is where most forms are signed. */
  signPage: number | null;
  signCorner: SignCorner;
  signSize: SignSize;
  perSheet: 2 | 4;
  imageLevel: ImageCompressionLevel;
};

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  numberPosition: "bottom-center",
  numberFormat: "plain",
  watermarkKind: "text",
  watermarkText: "สำเนาถูกต้อง",
  watermarkPlacement: "diagonal",
  signPage: null,
  signCorner: "bottom-right",
  signSize: "medium",
  perSheet: 2,
  imageLevel: "balanced",
};

export const SIGN_WIDTH: Record<SignSize, number> = { small: 0.2, medium: 0.28, large: 0.36 };
export const WATERMARK_MAX_LENGTH = 40;

export type ShownStamp = PngStamp & { url: string };

type Choice<T extends string | number> = { value: T; label: string; hint?: string };

function Choices<T extends string | number>(props: {
  name: string;
  legend: string;
  value: T;
  choices: Array<Choice<T>>;
  onChange: (value: T) => void;
  inline?: boolean;
}) {
  return (
    <fieldset className={`option-group ${props.inline ? "inline-options" : ""}`}>
      <legend>{props.legend}</legend>
      {props.choices.map((choice) => {
        const id = `${props.name}-${choice.value}`;
        return (
          <label key={choice.value} htmlFor={id} className={props.value === choice.value ? "selected" : ""}>
            <input id={id} type="radio" name={props.name} checked={props.value === choice.value} onChange={() => props.onChange(choice.value)} />
            {choice.hint ? <span><strong>{choice.label}</strong><small>{choice.hint}</small></span> : <strong>{choice.label}</strong>}
          </label>
        );
      })}
    </fieldset>
  );
}

export function ToolSettings(props: {
  tool: ToolId;
  options: ToolOptions;
  setOption: <K extends keyof ToolOptions>(key: K, value: ToolOptions[K]) => void;
  pageCount: number;
  hasPdf: boolean;
  hasImages: boolean;
  watermarkImage: ShownStamp | null;
  onWatermarkImage: (file: File) => void;
  signature: ShownStamp | null;
  onSignature: (stamp: PngStamp | null) => void;
  redaction: { marks: number; pages: number };
  onClearRedactions: () => void;
  metadata: MetadataEntry[] | null;
}) {
  const { tool, options, setOption } = props;

  if (tool === "page-numbers") {
    return (
      <>
        <Choices name="number-position" legend="ตำแหน่งเลขหน้า" value={options.numberPosition} onChange={(value) => setOption("numberPosition", value)}
          choices={[{ value: "bottom-center", label: "กลางท้ายกระดาษ" }, { value: "bottom-right", label: "มุมขวาล่าง" }, { value: "top-right", label: "มุมขวาบน" }]} />
        <Choices name="number-format" legend="รูปแบบ" inline value={options.numberFormat} onChange={(value) => setOption("numberFormat", value)}
          choices={[{ value: "plain", label: "1" }, { value: "of-total", label: `1 / ${props.pageCount}` }]} />
      </>
    );
  }

  if (tool === "watermark") {
    return (
      <>
        <Choices name="watermark-kind" legend="ลายน้ำแบบ" inline value={options.watermarkKind} onChange={(value) => setOption("watermarkKind", value)}
          choices={[{ value: "text", label: "ข้อความ" }, { value: "image", label: "โลโก้ / รูป" }]} />
        {options.watermarkKind === "text" ? (
          <label className="option-field">
            <span>ข้อความลายน้ำ</span>
            <input type="text" value={options.watermarkText} maxLength={WATERMARK_MAX_LENGTH} onChange={(event) => setOption("watermarkText", event.target.value)} />
            <small>เช่น สำเนาถูกต้อง · ใช้สำหรับสมัครงานเท่านั้น</small>
          </label>
        ) : (
          <div className="option-stamp">
            {props.watermarkImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={props.watermarkImage.url} alt="โลโก้ที่เลือก" />
            )}
            <label className="option-file">
              {props.watermarkImage ? "เปลี่ยนรูป" : "เลือกโลโก้ (PNG / JPG)"}
              <input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onWatermarkImage(file); event.target.value = ""; }} />
            </label>
          </div>
        )}
        <Choices name="watermark-placement" legend="ตำแหน่ง" value={options.watermarkPlacement} onChange={(value) => setOption("watermarkPlacement", value)}
          choices={[{ value: "diagonal", label: "กลางหน้า แนวเฉียง", hint: "จางลง อ่านเอกสารได้ตามปกติ" }, { value: "corner", label: "มุมขวาล่าง", hint: "เล็กและชัด เหมาะกับโลโก้" }]} />
      </>
    );
  }

  if (tool === "sign") {
    const pageChoices = Array.from({ length: props.pageCount }, (_, index) => index + 1);
    return (
      <>
        {props.signature ? (
          <div className="option-stamp">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={props.signature.url} alt="ลายเซ็นที่จะใช้" />
            <button type="button" className="option-button" onClick={() => props.onSignature(null)}>เซ็นใหม่</button>
          </div>
        ) : (
          <SignaturePad onReady={(stamp) => props.onSignature(stamp)} />
        )}
        <label className="option-field">
          <span>วางบนหน้า</span>
          <select value={options.signPage ?? 0} onChange={(event) => setOption("signPage", Number(event.target.value) || null)}>
            <option value={0}>หน้าสุดท้าย</option>
            {pageChoices.map((page) => <option key={page} value={page}>หน้า {page}</option>)}
          </select>
        </label>
        <Choices name="sign-corner" legend="ตำแหน่งด้านล่างของหน้า" inline value={options.signCorner} onChange={(value) => setOption("signCorner", value)}
          choices={[{ value: "bottom-left", label: "ซ้าย" }, { value: "bottom-center", label: "กลาง" }, { value: "bottom-right", label: "ขวา" }]} />
        <Choices name="sign-size" legend="ขนาด" inline value={options.signSize} onChange={(value) => setOption("signSize", value)}
          choices={[{ value: "small", label: "เล็ก" }, { value: "medium", label: "กลาง" }, { value: "large", label: "ใหญ่" }]} />
      </>
    );
  }

  if (tool === "redact") {
    return (
      <div className="settings-copy">
        <p>แตะหน้าที่มีข้อมูลเพื่อเปิดแบบเต็มจอ แล้วลากกรอบทับส่วนที่ต้องการปิด เช่น เลขบัตรประชาชนหรือเบอร์โทร</p>
        <dl><div><dt>กรอบที่ลากไว้</dt><dd>{props.redaction.marks}</dd></div><div><dt>หน้าที่มีกรอบ</dt><dd>{props.redaction.pages}</dd></div></dl>
        {props.redaction.marks > 0 && <button type="button" className="option-button" onClick={props.onClearRedactions}>ล้างกรอบทั้งหมด</button>}
        <p className="flatten-warning">หน้าที่มีกรอบจะกลายเป็นภาพ ข้อความใต้กรอบถูกลบออกจริง จึงคัดลอกหรือค้นหาข้อความในหน้านั้นไม่ได้อีก</p>
      </div>
    );
  }

  if (tool === "strip-metadata") {
    return (
      <div className="settings-copy">
        {props.hasImages && <p className="flatten-warning">เครื่องมือนี้ใช้กับ PDF · ถ้าต้องการลบข้อมูลตำแหน่งในรูป ให้ใช้ “ย่อรูป”</p>}
        {props.metadata === null ? (
          <p>กำลังอ่านข้อมูลแฝง…</p>
        ) : props.metadata.length ? (
          <>
            <p>พบข้อมูลแฝงในไฟล์ ระบบจะลบออกทั้งหมด</p>
            <ul className="metadata-list">
              {props.metadata.map((entry, index) => <li key={`${entry.label}-${index}`}><span>{entry.label}</span><strong>{entry.value}</strong></li>)}
            </ul>
          </>
        ) : (
          <p>ไม่พบข้อมูลแฝงที่อ่านได้ ระบบจะลบส่วนที่ซ่อนอยู่ให้อีกรอบเพื่อความแน่ใจ</p>
        )}
      </div>
    );
  }

  if (tool === "resize-a4") {
    return <div className="settings-copy"><p>ทุกหน้าจะถูกย่อหรือขยายให้พอดีกระดาษ A4 ตามแนวเดิมของหน้า โดยไม่บิดสัดส่วน ข้อความยังคมชัดและค้นหาได้</p></div>;
  }

  if (tool === "n-up") {
    return (
      <Choices name="per-sheet" legend="จำนวนหน้าต่อแผ่น" value={options.perSheet} onChange={(value) => setOption("perSheet", value)}
        choices={[{ value: 2, label: "2 หน้าต่อแผ่น", hint: "กระดาษ A4 แนวนอน" }, { value: 4, label: "4 หน้าต่อแผ่น", hint: "กระดาษ A4 แนวตั้ง" }]} />
    );
  }

  if (tool === "image-compress") {
    return (
      <>
        {props.hasPdf && <p className="flatten-warning">เครื่องมือนี้ใช้กับรูป JPG / PNG · ถ้าต้องการลดขนาด PDF ให้ใช้ “บีบอัด PDF”</p>}
        <Choices name="image-level" legend="ระดับการย่อ" value={options.imageLevel} onChange={(value) => setOption("imageLevel", value)}
          choices={(Object.keys(IMAGE_COMPRESSION) as ImageCompressionLevel[]).map((level) => ({ value: level, label: IMAGE_COMPRESSION[level].label, hint: IMAGE_COMPRESSION[level].hint }))} />
        <p className="flatten-warning">ได้ไฟล์ JPG เสมอ ส่วนโปร่งใสของ PNG จะเป็นสีขาว และข้อมูลตำแหน่ง GPS ในรูปถูกลบออก</p>
      </>
    );
  }

  return null;
}

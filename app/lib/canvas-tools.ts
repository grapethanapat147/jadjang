/**
 * The canvas half of the new tools. Thai text, signatures, photos and
 * redaction all pass through a canvas here, because the browser shapes Thai
 * and decodes images correctly where pdf-lib's standard fonts cannot.
 *
 * The geometry is kept in small pure functions at the top so it can be tested
 * without a browser.
 */

export type NormalizedRect = { x: number; y: number; width: number; height: number };

/** Long edge capped at `maxEdge`, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A drag between two points inside a frame, as fractions of that frame. Tiny drags are ignored. */
export function dragToRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  frame: { width: number; height: number },
): NormalizedRect | null {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const left = clamp(Math.min(start.x, end.x), frame.width);
  const top = clamp(Math.min(start.y, end.y), frame.height);
  const right = clamp(Math.max(start.x, end.x), frame.width);
  const bottom = clamp(Math.max(start.y, end.y), frame.height);
  if (right - left < 6 || bottom - top < 6) return null;
  return {
    x: left / frame.width,
    y: top / frame.height,
    width: (right - left) / frame.width,
    height: (bottom - top) / frame.height,
  };
}

/** Grown by a few pixels: a box that just grazes a line of text leaves slivers of it. */
export function rectInPixels(rect: NormalizedRect, width: number, height: number, bleed = 2) {
  const x = Math.max(0, Math.floor(rect.x * width) - bleed);
  const y = Math.max(0, Math.floor(rect.y * height) - bleed);
  return {
    x,
    y,
    width: Math.min(width - x, Math.ceil(rect.width * width) + bleed * 2),
    height: Math.min(height - y, Math.ceil(rect.height * height) + bleed * 2),
  };
}

export type ImageCompressionLevel = "small" | "balanced" | "quality";

export const IMAGE_COMPRESSION: Record<ImageCompressionLevel, { maxEdge: number; quality: number; label: string; hint: string }> = {
  small: { maxEdge: 1280, quality: 0.62, label: "ไฟล์เล็ก", hint: "ด้านยาว 1280 px เหมาะกับแนบแบบฟอร์ม" },
  balanced: { maxEdge: 1920, quality: 0.75, label: "สมดุล", hint: "ด้านยาว 1920 px แนะนำสำหรับงานทั่วไป" },
  quality: { maxEdge: 2560, quality: 0.85, label: "คมชัด", hint: "ด้านยาว 2560 px เหมาะกับรูปที่ต้องพิมพ์" },
};

/** Honest wording for a batch of shrunk photos, in the spirit of compressionNote. */
export function photoNote(inputBytes: number, outputBytes: number, count: number, comparable: boolean): string {
  const checked = `ตรวจครบ ${count} รูป และลบข้อมูลตำแหน่งแล้ว`;
  if (!comparable || inputBytes <= 0) return checked;
  if (outputBytes >= inputBytes) return `รูปไม่เล็กลง (ต้นฉบับเล็กอยู่แล้ว) แต่${checked}`;
  const saved = Math.max(1, Math.round(((inputBytes - outputBytes) / inputBytes) * 100));
  return `เล็กลง ${saved}% และ${checked}`;
}

// ------------------------------------------------------------- browser --

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("อุปกรณ์นี้ไม่รองรับการสร้างภาพ");
  return { canvas, context };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("สร้างภาพไม่สำเร็จ"))), type, quality),
  );
}

export type PngStamp = { bytes: Uint8Array; width: number; height: number };

async function pngOf(canvas: HTMLCanvasElement): Promise<PngStamp> {
  const blob = await toBlob(canvas, "image/png");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

const STAMP_FONT = '"Anuphan Variable", "Anuphan", "Noto Sans Thai", sans-serif';

/** Thai text as a transparent PNG, drawn large so it stays sharp when scaled onto a page. */
export async function renderTextStamp(text: string, color: string): Promise<PngStamp> {
  const size = 160;
  const font = `700 ${size}px ${STAMP_FONT}`;
  // Without waiting, the first stamp of a visit can be drawn in a fallback font.
  await document.fonts?.load(font, text).catch(() => undefined);
  const measure = canvasOf(1, 1).context;
  measure.font = font;
  const metrics = measure.measureText(text);
  const padding = size * 0.25;
  // Thai stacks marks above and below the line, so the box comes from the glyphs, not the font size.
  const ascent = Math.max(metrics.actualBoundingBoxAscent || size * 0.8, size * 0.8);
  const descent = Math.max(metrics.actualBoundingBoxDescent || size * 0.3, size * 0.3);
  const { canvas, context } = canvasOf(
    Math.ceil(metrics.width + padding * 2),
    Math.ceil(ascent + descent + padding * 2),
  );
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = "alphabetic";
  context.fillText(text, padding, padding + ascent);
  return pngOf(canvas);
}

/** Bounding box of everything not fully transparent, or null for an empty canvas. */
function inkBounds(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return null;
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** The drawn part of a signature pad, cropped, as a PNG. Null if nothing was drawn. */
export async function signatureFromPad(pad: HTMLCanvasElement): Promise<PngStamp | null> {
  const bounds = inkBounds(pad);
  if (!bounds) return null;
  const margin = 6;
  const { canvas, context } = canvasOf(bounds.width + margin * 2, bounds.height + margin * 2);
  context.drawImage(pad, bounds.left, bounds.top, bounds.width, bounds.height, margin, margin, bounds.width, bounds.height);
  return pngOf(canvas);
}

/**
 * A picked JPG or PNG re-drawn as PNG: pdf-lib then embeds one format, and
 * whatever the camera wrote into the file (location included) is left behind.
 */
export async function imageFileToPng(file: Blob, maxEdge = 1600): Promise<PngStamp> {
  const bitmap = await createImageBitmap(file);
  const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const { canvas, context } = canvasOf(size.width, size.height);
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  return pngOf(canvas);
}

/**
 * A photo re-encoded as a smaller JPEG. Re-drawing is also what removes EXIF,
 * GPS position included. Transparent areas of a PNG come out white.
 */
export async function compressPhoto(
  file: Blob,
  rotation: number,
  level: ImageCompressionLevel,
): Promise<Blob> {
  const setting = IMAGE_COMPRESSION[level];
  const bitmap = await createImageBitmap(file);
  const turned = ((rotation % 360) + 360) % 360;
  const sideways = turned === 90 || turned === 270;
  const fitted = fitWithin(bitmap.width, bitmap.height, setting.maxEdge);
  const { canvas, context } = canvasOf(sideways ? fitted.height : fitted.width, sideways ? fitted.width : fitted.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((turned * Math.PI) / 180);
  context.drawImage(bitmap, -fitted.width / 2, -fitted.height / 2, fitted.width, fitted.height);
  bitmap.close();
  return toBlob(canvas, "image/jpeg", setting.quality);
}

/** Paints the boxes solid black onto a rendered page and returns it as PNG bytes. */
export async function blackOut(canvas: HTMLCanvasElement, rects: NormalizedRect[]): Promise<Uint8Array> {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("อุปกรณ์นี้ไม่รองรับการปิดทึบ");
  context.fillStyle = "#000000";
  for (const rect of rects) {
    const box = rectInPixels(rect, canvas.width, canvas.height);
    context.fillRect(box.x, box.y, box.width, box.height);
  }
  const blob = await toBlob(canvas, "image/png");
  return new Uint8Array(await blob.arrayBuffer());
}

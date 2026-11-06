import { type PointerEvent, useEffect, useRef, useState } from "react";
import { type PngStamp, imageFileToPng, signatureFromPad } from "./lib/canvas-tools";

const INK = "#1b2a4a";

/**
 * Draw with a finger, pen or mouse, or pick a photo of a signature instead —
 * the second route is also how a keyboard-only user gets a signature in.
 */
export function SignaturePad({ onReady }: { onReady: (stamp: PngStamp) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Backing store at device resolution, or the strokes come out soft.
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2.6;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = INK;
  }, []);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 0.1, y + 0.1);
    context.stroke();
    setHasInk(true);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    const { x, y } = point(event);
    context?.lineTo(x, y);
    context?.stroke();
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setMessage(null);
  }

  async function applyDrawing() {
    const canvas = canvasRef.current;
    const stamp = canvas ? await signatureFromPad(canvas) : null;
    if (!stamp) {
      setMessage("ยังไม่มีลายเซ็นบนกระดาน");
      return;
    }
    onReady(stamp);
  }

  async function applyPicture(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setMessage("ใช้ได้เฉพาะรูป PNG หรือ JPG");
      return;
    }
    try {
      onReady(await imageFileToPng(file, 1200));
    } catch {
      setMessage("อ่านรูปนี้ไม่ได้ ลองรูปอื่น");
    }
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        aria-label="กระดานเซ็นชื่อ ลากนิ้วหรือเมาส์เพื่อเซ็น"
        role="img"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => { drawing.current = false; }}
        onPointerCancel={() => { drawing.current = false; }}
      />
      <div className="signature-actions">
        <button type="button" className="option-button" onClick={clear} disabled={!hasInk}>ล้าง</button>
        <button type="button" className="option-button primary" onClick={() => void applyDrawing()} disabled={!hasInk}>ใช้ลายเซ็นนี้</button>
      </div>
      <label className="option-file">
        หรือใช้รูปลายเซ็น (PNG / JPG)
        <input type="file" accept="image/png,image/jpeg" onChange={(event) => { void applyPicture(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      {message && <p className="option-message" role="status">{message}</p>}
    </div>
  );
}

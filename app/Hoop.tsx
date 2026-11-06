import { forwardRef } from "react";
import { type Point, SHOT, SHOT_TOTAL_MS, ballLabel, shotKeyframes } from "./lib/game-mode";

/** Rim centre and depth in the hoop's 220×200 viewBox. */
const RIM = { x: 110, y: 134, net: 52 };
const VIEW_WIDTH = 220;
const BALL = { w: 44, h: 56 };

/**
 * Two layers so a ball can pass between them: the back of the rim behind it,
 * the front of the rim and the net in front.
 */
export const Hoop = forwardRef<HTMLDivElement>(function Hoop(_, ref) {
  return (
    <div className="hoop" ref={ref} aria-hidden="true">
      <svg className="hoop-back" viewBox="0 0 220 200">
        <rect className="hoop-board" x="20" y="8" width="180" height="112" rx="12" />
        <rect className="hoop-square" x="78" y="52" width="64" height="46" rx="4" />
        <rect className="hoop-bracket" x="104" y="118" width="12" height="14" rx="2" />
        <path className="hoop-rim" d="M58 134 A52 11 0 0 1 162 134" />
      </svg>
      <svg className="hoop-front" viewBox="0 0 220 200">
        <g className="hoop-net">
          <path d="M60 136 L80 186" /><path d="M78 141 L92 188" /><path d="M96 144 L104 189" />
          <path d="M124 144 L116 189" /><path d="M142 141 L128 188" /><path d="M160 136 L140 186" />
          <path d="M66 152 L154 152" /><path d="M73 170 L147 170" />
        </g>
        <path className="hoop-rim" d="M58 134 A52 11 0 0 0 162 134" />
      </svg>
    </div>
  );
});

const BALL_MARKUP = `<svg class="hoop-ball" viewBox="0 0 44 56">
  <path class="ball-sheet" d="M5 3 H29 L40 14 V51 a3 3 0 0 1 -3 3 H5 a3 3 0 0 1 -3 -3 V6 a3 3 0 0 1 3 -3 Z"/>
  <path class="ball-fold" d="M29 3 V11 a3 3 0 0 0 3 3 H40"/>
  <rect class="ball-band" x="2" y="30" width="38" height="14" rx="2"/>
  <text class="ball-label" x="21" y="40.5" text-anchor="middle" font-size="9"></text>
  <path class="ball-lines" d="M8 13 H22 M8 19 H30 M8 24 H26"/>
</svg>`;

/**
 * Plays the shot in a fixed layer over a copy of the hoop, not in the hoop
 * itself: the files are already being read, and the drop zone holding the
 * hoop disappears as soon as the first page is ready — often mid-flight.
 */
export function throwIntoHoop(hoop: HTMLElement | null, start: Point, fileNames: string[]): void {
  if (!hoop || !fileNames.length || !("animate" in hoop)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = hoop.getBoundingClientRect();
  if (!box.width) return;
  const scale = box.width / VIEW_WIDTH;

  const layer = document.createElement("div");
  layer.className = "hoop-shot";
  layer.setAttribute("aria-hidden", "true");
  // The accent is set per tool on the workspace, which this layer sits outside.
  layer.style.setProperty("--accent", getComputedStyle(hoop).getPropertyValue("--accent"));
  const copy = hoop.cloneNode(true) as HTMLElement;
  Object.assign(copy.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, margin: "0" });
  const balls = document.createElement("div");
  balls.className = "hoop-balls";
  copy.insertBefore(balls, copy.querySelector(".hoop-front"));
  layer.append(copy);
  document.body.append(layer);

  const rim = { x: box.left + RIM.x * scale, y: box.top + RIM.y * scale };
  const frames = shotKeyframes(start, rim, RIM.net * scale, { w: BALL.w / 2, h: BALL.h / 2 });
  const net = copy.querySelector(".hoop-net");

  const shots = fileNames.slice(0, SHOT.maxBalls).map((name, index) => {
    const holder = document.createElement("div");
    holder.innerHTML = BALL_MARKUP;
    const ball = holder.firstElementChild as SVGElement;
    ball.querySelector(".ball-label")!.textContent = ballLabel(name);
    balls.append(ball);
    return ball
      .animate(frames, { duration: SHOT_TOTAL_MS, delay: index * SHOT.staggerMs, easing: "linear", fill: "both" })
      .finished.then(() => {
        net?.animate(
          [{ transform: "scaleY(1)" }, { transform: "scaleY(1.2)" }, { transform: "scaleY(.95)" }, { transform: "scaleY(1)" }],
          { duration: 380, easing: "ease-out" },
        );
      });
  });

  Promise.allSettled(shots)
    .then(() => layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay: 300, fill: "forwards" }).finished)
    .catch(() => undefined)
    .finally(() => layer.remove());
}

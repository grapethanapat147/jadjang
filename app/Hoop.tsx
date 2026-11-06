import { forwardRef } from "react";
import { type HoopGeometry, type Point, SHOT, ballLabel, planShot, shotKind } from "./lib/game-mode";

/** Rim centre, half-width and net depth in the hoop's 220×210 viewBox. */
const RIM = { x: 110, y: 134, half: 52, net: 58 };
const VIEW_WIDTH = 220;
/** Strong ease-out for the reactions: they start on impact and settle. */
const SETTLE = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Net as a diamond mesh: rows of points narrowing towards the bottom, each
 * joined to its neighbours below. The top row follows the front of the rim.
 */
function netPaths(): string[] {
  const rows = [
    { y: 0, half: 52 },
    { y: 18, half: 44 },
    { y: 36, half: 37 },
    { y: 54, half: 31 },
  ];
  const columns = 7;
  const point = (row: number, column: number) => {
    const { y, half } = rows[row];
    const x = RIM.x + half * (-1 + (2 * column) / (columns - 1));
    // The first row sits on the front half of the rim's ellipse.
    const sag = row === 0 ? 11 * Math.sqrt(Math.max(0, 1 - ((x - RIM.x) / RIM.half) ** 2)) : 11 * 0.6;
    return `${x.toFixed(1)} ${(RIM.y + y + sag).toFixed(1)}`;
  };
  const paths: string[] = [];
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      paths.push(`M${point(row, column)} L${point(row + 1, column + 1)}`);
      paths.push(`M${point(row, column + 1)} L${point(row + 1, column)}`);
    }
  }
  paths.push(`M${point(rows.length - 1, 0)} L${point(rows.length - 1, columns - 1)}`);
  return paths;
}

const NET = netPaths().join(" ");

/**
 * Two layers so a ball can pass between them: board and the back of the rim
 * behind it, the net and the front of the rim in front.
 */
export const Hoop = forwardRef<HTMLDivElement>(function Hoop(_, ref) {
  return (
    <div className="hoop" ref={ref} aria-hidden="true">
      <svg className="hoop-back" viewBox="0 0 220 210">
        <defs>
          <linearGradient id="hoop-gloss" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.7" />
            <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="hoop-metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a7b0bf" />
            <stop offset="1" stopColor="#5d6676" />
          </linearGradient>
          <linearGradient id="hoop-rim-back" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c5462a" />
            <stop offset="1" stopColor="#8d2c18" />
          </linearGradient>
        </defs>
        <g className="hoop-board">
          <rect x="24" y="14" width="180" height="112" rx="12" fill="rgba(17,19,26,.18)" />
          <rect className="hoop-board-face" x="20" y="8" width="180" height="112" rx="12" />
          <rect className="hoop-square" x="78" y="52" width="64" height="46" rx="4" />
          <path d="M28 12h96l-40 104H28a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill="url(#hoop-gloss)" />
          <rect x="102" y="118" width="16" height="16" rx="3" fill="url(#hoop-metal)" />
        </g>
        <g className="hoop-rimset">
          <path d="M58 134 A52 11 0 0 1 162 134" fill="none" stroke="url(#hoop-rim-back)" strokeWidth="6" strokeLinecap="round" />
        </g>
      </svg>
      <svg className="hoop-front" viewBox="0 0 220 210">
        <defs>
          <linearGradient id="hoop-rim-front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff8a62" />
            <stop offset="1" stopColor="#d2462a" />
          </linearGradient>
        </defs>
        <g className="hoop-net">
          <path d={NET} fill="none" stroke="rgba(32,37,51,.32)" strokeWidth="3.2" strokeLinecap="round" transform="translate(0 1)" />
          <path d={NET} fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        </g>
        <g className="hoop-rimset">
          <path d="M58 134 A52 11 0 0 0 162 134" fill="none" stroke="url(#hoop-rim-front)" strokeWidth="6.5" strokeLinecap="round" />
          <path d="M62 136 A48 9 0 0 0 158 136" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
});

const BALL_MARKUP = `<div class="hoop-ball"><svg viewBox="0 0 44 56">
  <defs>
    <linearGradient id="ball-sheet" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9e0ec"/></linearGradient>
    <linearGradient id="ball-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".5"/><stop offset=".55" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  </defs>
  <path d="M5 3 H29 L40 14 V51 a3 3 0 0 1 -3 3 H5 a3 3 0 0 1 -3 -3 V6 a3 3 0 0 1 3 -3 Z" fill="url(#ball-sheet)" stroke="#b6bfce" stroke-width="1.2"/>
  <path d="M29 3 V11 a3 3 0 0 0 3 3 H40 Z" fill="#c9d1de"/>
  <path d="M8 13 H22 M8 19 H30 M8 24 H26" stroke="#c9d1de" stroke-width="2" stroke-linecap="round"/>
  <rect class="ball-band" x="2" y="30" width="38" height="14" rx="2"/>
  <rect x="2" y="30" width="38" height="14" rx="2" fill="url(#ball-shine)"/>
  <text class="ball-label" x="21" y="40.5" text-anchor="middle" font-size="9"></text>
</svg></div>`;

function hoopGeometry(box: DOMRect): HoopGeometry {
  const scale = box.width / VIEW_WIDTH;
  return {
    rim: { x: box.left + RIM.x * scale, y: box.top + RIM.y * scale },
    halfWidth: RIM.half * scale,
    netDepth: RIM.net * scale,
    boardY: box.top + 80 * scale,
  };
}

/**
 * Plays the shots in a fixed layer over a copy of the hoop, not in the hoop
 * itself: the files are already being read, and the drop zone holding the
 * hoop disappears as soon as the first page is ready — often mid-flight.
 */
export function throwIntoHoop(hoop: HTMLElement | null, start: Point, fileNames: string[]): Promise<void> | undefined {
  if (!hoop || !fileNames.length || !("animate" in hoop)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = hoop.getBoundingClientRect();
  if (!box.width) return;
  const geometry = hoopGeometry(box);

  const layer = document.createElement("div");
  layer.className = "hoop-shot";
  layer.setAttribute("aria-hidden", "true");
  // The accent is set per tool on the workspace, which this layer sits outside.
  layer.style.setProperty("--accent", getComputedStyle(hoop).getPropertyValue("--accent"));
  const floor = document.createElement("div");
  floor.className = "hoop-balls";
  const copy = hoop.cloneNode(true) as HTMLElement;
  Object.assign(copy.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, margin: "0" });
  const balls = document.createElement("div");
  balls.className = "hoop-balls";
  copy.insertBefore(balls, copy.querySelector(".hoop-front"));
  layer.append(floor, copy);
  document.body.append(layer);

  const net = copy.querySelector(".hoop-net");
  const rims = copy.querySelectorAll(".hoop-rimset");
  const board = copy.querySelector(".hoop-board");
  const shown = fileNames.slice(0, SHOT.maxBalls);
  let lastNet = 0;

  const shots = shown.map((name, index) => {
    const kind = shotKind(index);
    const plan = planShot(start, geometry, kind);
    const delay = index * SHOT.staggerMs;
    const side = start.x <= geometry.rim.x ? 1 : -1;
    lastNet = Math.max(lastNet, delay + plan.netAt);

    const holder = document.createElement("div");
    holder.innerHTML = BALL_MARKUP;
    const ball = holder.firstElementChild as HTMLElement;
    ball.querySelector(".ball-label")!.textContent = ballLabel(name);
    balls.append(ball);
    const shadow = document.createElement("div");
    shadow.className = "hoop-ball-shadow";
    floor.append(shadow);

    shadow.animate(plan.shadow, { duration: plan.duration, delay, easing: "linear", fill: "both" });

    if (plan.contact?.kind === "rim") {
      rims.forEach((rim) =>
        rim.animate(
          [{ transform: "rotate(0deg)" }, { transform: `rotate(${5 * side}deg)` }, { transform: `rotate(${-3 * side}deg)` }, { transform: `rotate(${1.2 * side}deg)` }, { transform: "rotate(0deg)" }],
          { duration: 460, delay: delay + plan.contact!.at, easing: SETTLE },
        ),
      );
    } else if (plan.contact?.kind === "board") {
      board?.animate(
        [{ transform: "translate(0, 0)" }, { transform: `translate(${3 * side}px, -1px)` }, { transform: `translate(${-2 * side}px, 1px)` }, { transform: `translate(${side}px, 0)` }, { transform: "translate(0, 0)" }],
        { duration: 380, delay: delay + plan.contact.at, easing: SETTLE },
      );
    }
    // The net stretches with the ball's weight, then springs back past rest.
    net?.animate(
      [{ transform: "scale(1, 1)" }, { transform: "scale(0.86, 1.34)" }, { transform: "scale(1.05, 0.9)" }, { transform: "scale(0.98, 1.05)" }, { transform: "scale(1, 1)" }],
      { duration: 620, delay: delay + plan.netAt + 60, easing: SETTLE },
    );

    return ball.animate(plan.ball, { duration: plan.duration, delay, easing: "linear", fill: "both" }).finished;
  });

  const score = document.createElement("p");
  score.className = "hoop-score";
  score.textContent = shown.length > 1 ? `ลงห่วง ${shown.length} ลูก!` : "ลงห่วง!";
  Object.assign(score.style, { left: `${geometry.rim.x}px`, top: `${box.top}px` });
  layer.append(score);
  score.animate(
    [{ opacity: 0, transform: "translate(-50%, 8px) scale(0.92)" }, { opacity: 1, transform: "translate(-50%, 0) scale(1)" }],
    { duration: 240, delay: lastNet + 80, easing: SETTLE, fill: "both" },
  );

  // Once the last ball is through the net, the workspace takes over and this
  // layer fades out at the same moment, rather than floating over it.
  const handOver = lastNet + 420;
  layer
    .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay: handOver, easing: "ease-out", fill: "forwards" })
    .finished.catch(() => undefined)
    .finally(() => layer.remove());
  void Promise.allSettled(shots);
  return new Promise((resolve) => window.setTimeout(resolve, handOver));
}

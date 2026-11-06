/**
 * Opt-in game mode: files thrown into a hoop instead of dropped in a box.
 *
 * Purely decorative. The files are read the moment they arrive, exactly as in
 * the normal mode, and the shot plays alongside — the game never makes anyone
 * wait, and every shot goes in: there is no aiming and no missing.
 */

export const GAME_MODE_STORAGE_KEY = "jadjang-game-mode";

/** Values tuned in the prototype (scratchpad jadjang-game-upload-prototype.html). */
export const SHOT = {
  arcHeightPx: 160,
  flightMs: 750,
  /** Falling through the net, as a share of the flight. */
  dropShare: 0.35,
  spinDeg: 540,
  /** One ball per file up to this many, so a 24-file drop stays short. */
  maxBalls: 8,
  staggerMs: 170,
} as const;

export const SHOT_TOTAL_MS = Math.round(SHOT.flightMs * (1 + SHOT.dropShare));

export type Point = { x: number; y: number };

/**
 * Stored choice is the source of truth, read through useSyncExternalStore like
 * the theme: the server renders "off" and the client corrects it without a
 * hydration mismatch. shortcut: with storage blocked the switch cannot turn on;
 * add an in-memory fallback if that ever matters.
 */
export const GAME_MODE_CHANGE_EVENT = "jadjang:gamemodechange";

export function subscribeGameMode(onChange: () => void): () => void {
  window.addEventListener(GAME_MODE_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(GAME_MODE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readGameMode(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return storage?.getItem(GAME_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Off is stored as no key at all, like the theme's "system". */
export function writeGameMode(storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined, on: boolean): void {
  try {
    if (on) {
      storage?.setItem(GAME_MODE_STORAGE_KEY, "1");
    } else {
      storage?.removeItem(GAME_MODE_STORAGE_KEY);
    }
  } catch {
    // Blocked storage only means the choice is not remembered.
  }
}

export function ballLabel(fileName: string): "PDF" | "JPG" | "PNG" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "PNG";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "JPG";
  return "PDF";
}

/**
 * Keyframes for one ball, from `start` to the rim centre and down through the
 * net. Horizontal speed is constant and height follows a parabola — the shape
 * a real throw makes — so the animation runs with linear easing.
 * `half` is half the ball's size, so the ball's centre travels the path.
 */
export function shotKeyframes(start: Point, rim: Point, netDepth: number, half: { w: number; h: number }): Keyframe[] {
  const over = { x: rim.x, y: rim.y - 8 };
  const frames: Keyframe[] = [];
  const flightSteps = 40;
  const dropSteps = 14;
  const flightShare = 1 / (1 + SHOT.dropShare);
  const place = (x: number, y: number, rotate: number, scale: number) =>
    `translate(${(x - half.w).toFixed(1)}px, ${(y - half.h).toFixed(1)}px) rotate(${rotate.toFixed(1)}deg) scale(${scale.toFixed(3)})`;

  for (let i = 0; i <= flightSteps; i += 1) {
    const t = i / flightSteps;
    const x = start.x + (over.x - start.x) * t;
    const y = start.y + (over.y - start.y) * t - SHOT.arcHeightPx * 4 * t * (1 - t);
    frames.push({ offset: t * flightShare, transform: place(x, y, SHOT.spinDeg * t, 1), opacity: 1 });
  }
  for (let i = 1; i <= dropSteps; i += 1) {
    const t = i / dropSteps;
    frames.push({
      offset: flightShare + t * (1 - flightShare),
      transform: place(over.x, over.y + (netDepth + 22) * t * t, SHOT.spinDeg + 18 * t, 1 - 0.28 * t),
      opacity: t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45,
    });
  }
  frames[frames.length - 1].offset = 1;
  return frames;
}

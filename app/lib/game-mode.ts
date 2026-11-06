/**
 * Opt-in game mode: files thrown into a hoop instead of dropped in a box.
 *
 * Purely decorative. The files are read the moment they arrive, exactly as in
 * the normal mode, and the shot plays alongside — the game never makes anyone
 * wait, and every shot goes in: there is no aiming and no missing.
 */

export const GAME_MODE_STORAGE_KEY = "jadjang-game-mode";

export const SHOT = {
  /** One ball per file up to this many, so a 24-file drop stays short. */
  maxBalls: 8,
  staggerMs: 220,
} as const;

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

// ----------------------------------------------------------------- physics --

/**
 * How a shot goes in. Every kind scores — the variety is only so a batch of
 * files does not look like one clip on repeat.
 */
export type ShotKind = "swish" | "rim" | "board";

export function shotKind(index: number): ShotKind {
  return (["rim", "swish", "board"] as const)[index % 3];
}

/** The hoop as it sits on screen, in viewport pixels. */
export type HoopGeometry = {
  rim: Point;
  /** Half the rim's width. */
  halfWidth: number;
  /** How far the net hangs below the rim. */
  netDepth: number;
  /** Where on the backboard a bank shot touches. */
  boardY: number;
};

export type ShotPlan = {
  duration: number;
  ball: Keyframe[];
  shadow: Keyframe[];
  /** Milliseconds from the start: when the ball touches rim or board, if it does. */
  contact: { kind: "rim" | "board"; at: number } | null;
  /** When the ball enters the net. */
  netAt: number;
};

type Sample = { t: number; x: number; y: number; depth: number; spin: number; tilt: number; squashX: number; squashY: number; opacity: number };

const BALL = { width: 44, height: 56 };

/**
 * A ball under constant gravity from `from` to `to`, peaking `rise` pixels
 * above the higher of the two. Horizontal speed is constant and height is a
 * parabola in time, which is what a thrown object does — so the keyframes run
 * on linear timing and the curve itself is the easing.
 */
export function arc(from: Point, to: Point, rise: number) {
  const drop = to.y - from.y;
  const height = from.y - (Math.min(from.y, to.y) - rise);
  const b = 8 * drop + 16 * height;
  const pull = (b + Math.sqrt(Math.max(0, b * b - 64 * drop * drop))) / 32;
  return (t: number): Point => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + drop * t - 4 * pull * t * (1 - t),
  });
}

/** Size on screen as the ball recedes from `near` to `far` scale. Perspective, not a straight blend. */
export function depthScale(depth: number, near: number, far: number): number {
  return 1 / ((1 - depth) / near + depth / far);
}

export function planShot(start: Point, hoop: HoopGeometry, kind: ShotKind): ShotPlan {
  const { rim, halfWidth, netDepth } = hoop;
  // A real ball is about half the rim's width.
  const far = Math.min(1, Math.max(0.45, (halfWidth * 1.05) / BALL.width));
  const near = Math.max(far * 1.6, 1.2);
  const side = start.x <= rim.x ? 1 : -1;
  const backRim = { x: rim.x + side * halfWidth * 0.5, y: rim.y - halfWidth * 0.22 };
  const board = { x: rim.x + side * halfWidth * 0.3, y: hoop.boardY };
  const above = { x: rim.x, y: rim.y - 8 };
  const target = kind === "rim" ? backRim : kind === "board" ? board : above;

  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const flightMs = Math.min(900, Math.max(620, 520 + distance * 0.45));
  const contactMs = kind === "rim" ? 300 : kind === "board" ? 260 : 0;
  const dropMs = 400;
  const samples: Sample[] = [];
  const spin = 420 * side;

  const flight = arc(start, target, 90 + distance * 0.22);
  for (let i = 0; i <= 36; i += 1) {
    const t = i / 36;
    const at = flight(t);
    samples.push({ t: t * flightMs, ...at, depth: t, spin: spin * t, tilt: 38 * Math.sin(t * Math.PI * 3), squashX: 1, squashY: 1, opacity: 1 });
  }

  let spinNow = spin;
  if (kind !== "swish") {
    // Hitting something flattens the ball for a moment along the line of impact.
    const hit = kind === "rim" ? { x: 1.12, y: 0.86 } : { x: 0.86, y: 1.1 };
    const last = samples[samples.length - 1];
    last.squashX = hit.x;
    last.squashY = hit.y;
    const settle = kind === "rim"
      ? arc(target, above, 30 * far)
      : (u: number) => ({ x: target.x + (above.x - target.x) * u, y: target.y + (above.y - target.y) * u * u });
    for (let i = 1; i <= 12; i += 1) {
      const u = i / 12;
      spinNow = spin - side * 70 * u;
      const ease = Math.min(1, u * 3);
      samples.push({
        t: flightMs + u * contactMs,
        ...settle(u),
        depth: 1,
        spin: spinNow,
        tilt: 0,
        squashX: hit.x + (1 - hit.x) * ease,
        squashY: hit.y + (1 - hit.y) * ease,
        opacity: 1,
      });
    }
  }

  const netStart = flightMs + contactMs;
  for (let i = 1; i <= 14; i += 1) {
    const u = i / 14;
    samples.push({
      t: netStart + u * dropMs,
      x: above.x,
      y: above.y + (netDepth + 22) * Math.pow(u, 1.6),
      depth: 1 + u * 0.15,
      spin: spinNow + side * 20 * u,
      tilt: 0,
      // The net squeezes the ball as it passes through.
      squashX: 1 - 0.18 * Math.sin(u * Math.PI),
      squashY: 1 + 0.1 * Math.sin(u * Math.PI),
      opacity: u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5,
    });
  }

  const duration = netStart + dropMs;
  const floorNear = start.y + BALL.height * near * 0.55;
  const floorFar = rim.y + netDepth * 2.4;

  const ball: Keyframe[] = samples.map((sample) => {
    const scale = sample.depth <= 1 ? depthScale(sample.depth, near, far) : far * (1 - (sample.depth - 1));
    return {
      offset: sample.t / duration,
      transform:
        `translate(${(sample.x - BALL.width / 2).toFixed(1)}px, ${(sample.y - BALL.height / 2).toFixed(1)}px) ` +
        `scale(${(scale * sample.squashX).toFixed(3)}, ${(scale * sample.squashY).toFixed(3)}) ` +
        `perspective(420px) rotateY(${sample.tilt.toFixed(1)}deg) rotate(${sample.spin.toFixed(1)}deg)`,
      opacity: Number(sample.opacity.toFixed(3)),
    };
  });

  const shadow: Keyframe[] = samples.map((sample) => {
    const depth = Math.min(1, sample.depth);
    const floor = floorNear + (floorFar - floorNear) * depth;
    const lift = Math.max(0, floor - sample.y);
    const scale = depthScale(depth, near, far) * Math.max(0.35, 1 - lift / 520);
    return {
      offset: sample.t / duration,
      transform: `translate(${(sample.x - 30).toFixed(1)}px, ${(floor - 7).toFixed(1)}px) scale(${scale.toFixed(3)})`,
      opacity: Number((0.32 * Math.max(0.2, 1 - lift / 600) * sample.opacity).toFixed(3)),
    };
  });
  ball[ball.length - 1].offset = 1;
  shadow[shadow.length - 1].offset = 1;

  return {
    duration,
    ball,
    shadow,
    contact: kind === "swish" ? null : { kind, at: flightMs },
    netAt: netStart,
  };
}

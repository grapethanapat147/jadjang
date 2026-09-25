/**
 * Sizing and scheduling for the detail overlay's high-resolution render.
 *
 * The grid thumbnail is a 0.32-scale JPEG, so blowing it up to fill the overlay
 * shows no more detail than the card already did. The overlay therefore renders
 * the page again at the size it is actually displayed at.
 */

/** Beyond 2 the extra pixels are past what any current screen resolves. */
const MAX_PIXEL_RATIO = 2;

/**
 * Canvas ceilings, not design decisions: iOS Safari returns a blank canvas past
 * roughly 16.7M pixels, and 4,096 is the long edge most GPUs will texture.
 *
 * Both are set at the real limits rather than lower, because clamping below the
 * displayed device pixels is what makes the second render pointless — the spec's
 * own rule is that the overlay must not upscale.
 */
const MAX_RENDER_EDGE = 4_096;
const MAX_RENDER_PIXELS = 16_000_000;

export type DetailRenderSize = {
  width: number;
  height: number;
  /** Multiplier to hand pdf.js, relative to the page's natural point size. */
  scale: number;
};

/**
 * renderWidth = displayed CSS width x min(devicePixelRatio, 2), with the page's
 * own aspect ratio deciding the height, clamped only by what a canvas can hold.
 */
export function detailRenderSize(options: {
  cssWidth: number;
  /** The box's height. Given one, a portrait page is sized to fit it. */
  cssHeight?: number;
  pageWidth: number;
  pageHeight: number;
  devicePixelRatio?: number;
}): DetailRenderSize {
  const { cssWidth, cssHeight, pageWidth, pageHeight } = options;
  if (!(cssWidth > 0) || !(pageWidth > 0) || !(pageHeight > 0)) {
    throw new Error("detailRenderSize needs a positive width and page size");
  }

  const ratio = Math.min(
    MAX_PIXEL_RATIO,
    Math.max(1, options.devicePixelRatio ?? 1),
  );
  const aspect = pageHeight / pageWidth;

  // object-fit: contain, computed rather than assumed: a portrait page in a
  // landscape box is limited by the height, and rendering to the full box width
  // would produce four times the pixels the screen can show.
  const displayWidth =
    cssHeight && cssHeight > 0 ? Math.min(cssWidth, cssHeight / aspect) : cssWidth;

  let width = displayWidth * ratio;
  let height = width * aspect;

  // Clamp on whichever limit binds first, scaling both edges so the aspect holds.
  const overshoot = Math.max(
    width / MAX_RENDER_EDGE,
    height / MAX_RENDER_EDGE,
    Math.sqrt((width * height) / MAX_RENDER_PIXELS),
    1,
  );
  width /= overshoot;
  height /= overshoot;

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    scale: width / pageWidth,
  };
}

export type DetailRenderQueue<T> = {
  /**
   * Renders `key`, or returns the cached result. Resolves to null when a later
   * request arrived first — the caller should drop a null rather than display it.
   */
  request(key: string, render: () => Promise<T>): Promise<T | null>;
  clear(onDrop?: (value: T) => void): void;
};

/**
 * One render at a time, newest wins. Paging through an overlay faster than the
 * renders complete would otherwise let an earlier page's image land on top of a
 * later one.
 */
export function createDetailRenderQueue<T>(): DetailRenderQueue<T> {
  const cache = new Map<string, T>();
  let latest = 0;

  return {
    async request(key, render) {
      const cached = cache.get(key);
      if (cached !== undefined) {
        latest += 1;
        return cached;
      }

      latest += 1;
      const ticket = latest;
      const value = await render();

      // Still store a superseded result: it is correct for its own key, and the
      // user paging back to it should not have to wait for a second render.
      cache.set(key, value);
      return ticket === latest ? value : null;
    },

    clear(onDrop) {
      if (onDrop) {
        cache.forEach(onDrop);
      }
      cache.clear();
      latest += 1;
    },
  };
}

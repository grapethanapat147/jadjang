export const YIELD_FALLBACK_MS = 100;

/**
 * Hands control back to the browser between heavy pages so the UI can paint.
 *
 * `requestAnimationFrame` never fires while a tab is hidden, so awaiting it on
 * its own freezes processing the moment the user switches tab or app — the
 * progress bar sticks and never recovers. The timeout is the escape hatch that
 * keeps the work moving in the background.
 */
export function yieldToBrowser(fallbackMs: number = YIELD_FALLBACK_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    setTimeout(finish, fallbackMs);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish);
    }
  });
}

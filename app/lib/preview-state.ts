/**
 * Which of the four things a page card is showing where its thumbnail goes.
 *
 * The card reserves the same frame for all of them, so the grid does not move
 * when a page changes state.
 */

/**
 * How many thumbnails an upload renders up front. Past this, the page still
 * opens full-size in the detail overlay — it just has no card image.
 *
 * Every piece of copy about the limit reads this value rather than repeating
 * the number, so the two can never drift apart.
 */
export const EAGER_PREVIEW_LIMIT = 36;

export type PreviewState = "ready" | "loading" | "unavailable" | "error";

export type PreviewFlags = {
  previewUrl?: string;
  previewFailed?: boolean;
  /** Set when the upload passed EAGER_PREVIEW_LIMIT before reaching this page. */
  previewSkipped?: boolean;
};

/**
 * A rendered thumbnail wins over everything: a page that failed and was then
 * retried successfully is ready, not still in error.
 */
export function previewState(page: PreviewFlags): PreviewState {
  if (page.previewUrl) {
    return "ready";
  }
  if (page.previewFailed) {
    return "error";
  }
  if (page.previewSkipped) {
    return "unavailable";
  }
  return "loading";
}

/** Only a failed render offers a retry; a skipped one is a limit, not a fault. */
export function canRetryPreview(page: PreviewFlags): boolean {
  return previewState(page) === "error";
}

export function unavailableReason(limit: number = EAGER_PREVIEW_LIMIT): string {
  return `ระบบสร้างรูปย่ออัตโนมัติถึงหน้า ${limit}`;
}

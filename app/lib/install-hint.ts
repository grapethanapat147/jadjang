/**
 * When to suggest installing จัดแจง to the home screen, and how.
 *
 * Shown only after a file has come out right, and never again once dismissed.
 */

export type InstallHint = "none" | "prompt" | "ios";

export const INSTALL_DISMISSED_KEY = "jadjang-install-dismissed";

/**
 * iOS has no install prompt; Safari's Share sheet is the only way. iPadOS
 * reports a desktop Mac user agent, so touch support gives it away. In-app
 * browsers (LINE, Facebook, Instagram) cannot add to the home screen at all.
 */
export function isIosBrowser(userAgent: string, maxTouchPoints = 0): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const inApp = /\bLine\/\d|FBAN|FBAV|FB_IAB|Instagram/.test(userAgent);
  return ios && !inApp;
}

export function installHint(context: {
  standalone: boolean;
  canPrompt: boolean;
  iosBrowser: boolean;
  dismissed: boolean;
}): InstallHint {
  if (context.standalone || context.dismissed) return "none";
  if (context.canPrompt) return "prompt";
  if (context.iosBrowser) return "ios";
  return "none";
}

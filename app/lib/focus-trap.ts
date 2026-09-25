/**
 * Keyboard containment for the detail overlay.
 *
 * Tab must not reach the workspace behind a modal dialog, so the last control
 * wraps to the first and the first back to the last.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Focusable controls inside `root`, in tab order, skipping hidden ones. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/**
 * The control Tab should move to, wrapping at both ends. Returns null when
 * there is nothing focusable to move to.
 */
export function nextTrapTarget<T>(
  elements: readonly T[],
  active: T | null,
  backwards: boolean,
): T | null {
  if (elements.length === 0) {
    return null;
  }

  const index = active === null ? -1 : elements.indexOf(active);
  if (index === -1) {
    return backwards ? elements[elements.length - 1] : elements[0];
  }

  const step = backwards ? -1 : 1;
  const next = (index + step + elements.length) % elements.length;
  return elements[next];
}

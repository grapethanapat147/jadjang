const ARROW_STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * Index an arrow, Home or End key should move a tablist to, or null when the
 * key is not one the tablist handles.
 *
 * Wrapping at both ends is what the WAI-ARIA tabs pattern expects, so a user
 * holding one arrow key can reach every tool without changing direction.
 */
export function nextToolIndex(key: string, currentIndex: number, total: number): number | null {
  if (total <= 0) {
    return null;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return total - 1;
  }

  const step = ARROW_STEPS[key];
  if (step === undefined) {
    return null;
  }

  const safeIndex = currentIndex < 0 ? 0 : currentIndex % total;
  return (safeIndex + step + total) % total;
}

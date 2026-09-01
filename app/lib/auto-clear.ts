export const AUTO_CLEAR_DELAY_MS = 45_000;
export const AUTO_CLEAR_DELAY_SECONDS = AUTO_CLEAR_DELAY_MS / 1000;

export type AutoClearTimer = {
  schedule(run: () => void): void;
  cancel(): void;
  isPending(): boolean;
};

/**
 * Single-shot timer for wiping the workspace after a download.
 *
 * It can only ever hold one pending run, so a second download click cannot stack
 * timers, and starting new work can cancel a wipe that would otherwise delete
 * files the user just added. The callback is supplied per `schedule` call so the
 * timer never holds on to a stale closure.
 */
export function createAutoClearTimer(delayMs: number = AUTO_CLEAR_DELAY_MS): AutoClearTimer {
  let handle: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (handle === null) {
      return;
    }
    clearTimeout(handle);
    handle = null;
  }

  return {
    cancel,
    isPending: (): boolean => handle !== null,
    schedule(run: () => void): void {
      cancel();
      handle = setTimeout(() => {
        handle = null;
        run();
      }, delayMs);
    },
  };
}

/**
 * Theme choice, its storage, and the snapshot the switcher subscribes to.
 *
 * The DOM attribute is the source of truth, not React state: an inline script
 * sets it before first paint, so reading it back is what keeps the control and
 * the page from disagreeing on the first frame.
 */

export type ThemeChoice = "light" | "dark" | "system";

/** What the page actually renders as, once "system" has been resolved. */
export type ResolvedTheme = "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];

export const THEME_STORAGE_KEY = "jadjang-theme";

/** Dispatched on the window so every switcher on the page stays in step. */
export const THEME_CHANGE_EVENT = "jadjang:themechange";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem" | "removeItem">;

/**
 * Reading storage throws outright in a private window with site data blocked,
 * so every access is guarded. An unreadable or unrecognised value means
 * "system", which is the same as never having chosen.
 */
export function readStoredTheme(storage: ReadableStorage | null | undefined): ThemeChoice {
  if (!storage) {
    return "system";
  }
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/**
 * "system" is stored as the absence of a key rather than as a value, so a
 * visitor who never touches the control leaves nothing behind.
 */
export function writeStoredTheme(
  storage: WritableStorage | null | undefined,
  choice: ThemeChoice,
): void {
  if (!storage) {
    return;
  }
  try {
    if (choice === "system") {
      storage.removeItem(THEME_STORAGE_KEY);
      return;
    }
    storage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // A preference that cannot be saved is not worth failing the click over.
  }
}

/** The data-theme value for a choice; null means remove the attribute. */
export function themeAttribute(choice: ThemeChoice): ResolvedTheme | null {
  return choice === "system" ? null : choice;
}

/** What a choice renders as, given what the system asks for. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice !== "system") {
    return choice;
  }
  return prefersDark ? "dark" : "light";
}

/** The choice a document is currently in, read back off the attribute. */
export function themeFromAttribute(value: string | null | undefined): ThemeChoice {
  return isThemeChoice(value) && value !== "system" ? value : "system";
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  light: "สว่าง",
  dark: "มืด",
  system: "ตามระบบ",
};

/**
 * Runs in <head> before the first paint. Without it the page renders in the
 * system theme and then flips, which is worse than having no switcher.
 *
 * Kept to one line, and built from the constants above so the key and the
 * accepted values cannot drift away from the module that reads them back.
 */
export const THEME_BOOT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

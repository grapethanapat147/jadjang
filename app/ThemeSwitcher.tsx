"use client";

import { type KeyboardEvent, useCallback, useSyncExternalStore } from "react";
import {
  THEME_CHANGE_EVENT,
  THEME_CHOICES,
  THEME_LABELS,
  type ThemeChoice,
  themeAttribute,
  themeFromAttribute,
  writeStoredTheme,
} from "./lib/theme";
import { nextTrapTarget } from "./lib/focus-trap";

/**
 * Subscribing to the document rather than holding the choice in React state.
 *
 * The inline boot script sets data-theme before React exists, so state would
 * start out disagreeing with the page. Reading the attribute back makes the
 * two impossible to desynchronise, and useSyncExternalStore renders the server
 * snapshot first, so there is no hydration mismatch either.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  // Another tab of the same app changing the preference.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const getSnapshot = (): ThemeChoice =>
  themeFromAttribute(document.documentElement.getAttribute("data-theme"));

/** Rendered on the server, where nothing has been chosen yet. */
const getServerSnapshot = (): ThemeChoice => "system";

const ICONS: Record<ThemeChoice, string> = {
  light: "☀",
  dark: "☾",
  system: "◐",
};

export function ThemeSwitcher() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const select = useCallback((next: ThemeChoice, moveFocus = false) => {
    const attribute = themeAttribute(next);
    if (attribute) {
      document.documentElement.setAttribute("data-theme", attribute);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    writeStoredTheme(globalThis.localStorage, next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

    if (moveFocus) {
      // Only the selected option is tabbable, so focus has to follow the
      // choice or the next Tab would leave the group from the wrong place.
      document
        .querySelector<HTMLElement>(`[data-theme-option="${next}"]`)
        ?.focus();
    }
  }, []);

  /**
   * A radiogroup is a single tab stop, so without this the only option a
   * keyboard can reach is the one already chosen — the control would be
   * unusable without a mouse.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const forwards = event.key === "ArrowRight" || event.key === "ArrowDown";
    if (!backwards && !forwards) {
      return;
    }
    event.preventDefault();
    const next = nextTrapTarget(THEME_CHOICES, choice, backwards);
    if (next) {
      select(next, true);
    }
  }

  return (
    <div className="theme-switcher" role="radiogroup" aria-label="ธีมของหน้าเว็บ">
      {THEME_CHOICES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={choice === option}
          tabIndex={choice === option ? 0 : -1}
          data-theme-option={option}
          className={`theme-option ${choice === option ? "selected" : ""}`}
          onClick={() => select(option)}
          onKeyDown={handleKeyDown}
        >
          <span className="theme-option-icon" aria-hidden="true">{ICONS[option]}</span>
          <span className="theme-option-label">{THEME_LABELS[option]}</span>
        </button>
      ))}
    </div>
  );
}

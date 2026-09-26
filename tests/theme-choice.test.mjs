import assert from "node:assert/strict";
import test from "node:test";
import {
  THEME_BOOT_SCRIPT,
  THEME_CHOICES,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  isThemeChoice,
  readStoredTheme,
  resolveTheme,
  themeAttribute,
  themeFromAttribute,
  writeStoredTheme,
} from "../app/lib/theme.ts";

/** A Map-backed Storage, optionally one that throws the way a locked-down browser does. */
function fakeStorage({ throwing = false, initial = {} } = {}) {
  const map = new Map(Object.entries(initial));
  const boom = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
  return {
    map,
    getItem: (key) => (throwing ? boom() : (map.has(key) ? map.get(key) : null)),
    setItem: (key, value) => (throwing ? boom() : void map.set(key, value)),
    removeItem: (key) => (throwing ? boom() : void map.delete(key)),
  };
}

// ------------------------------------------------------------ the choice --

test("only the three choices are accepted", () => {
  for (const choice of THEME_CHOICES) {
    assert.equal(isThemeChoice(choice), true, choice);
  }
  for (const bad of ["Dark", "", null, undefined, 0, {}, "auto"]) {
    assert.equal(isThemeChoice(bad), false, String(bad));
  }
});

test("every choice has a Thai label", () => {
  for (const choice of THEME_CHOICES) {
    assert.ok(THEME_LABELS[choice]?.length > 0, `${choice} needs a label`);
  }
});

// ---------------------------------------------------------------- storage --

test("nothing stored means system", () => {
  assert.equal(readStoredTheme(fakeStorage()), "system");
});

test("a stored choice comes back", () => {
  assert.equal(readStoredTheme(fakeStorage({ initial: { [THEME_STORAGE_KEY]: "dark" } })), "dark");
  assert.equal(readStoredTheme(fakeStorage({ initial: { [THEME_STORAGE_KEY]: "light" } })), "light");
});

test("a value we do not recognise is treated as no choice", () => {
  // Someone else's key collision, or a value from a future version.
  assert.equal(readStoredTheme(fakeStorage({ initial: { [THEME_STORAGE_KEY]: "midnight" } })), "system");
});

test("storage that throws does not take the page down", () => {
  // Private windows with site data blocked throw on access, not return null.
  assert.equal(readStoredTheme(fakeStorage({ throwing: true })), "system");
  assert.doesNotThrow(() => writeStoredTheme(fakeStorage({ throwing: true }), "dark"));
});

test("no storage at all is the same as no choice", () => {
  assert.equal(readStoredTheme(null), "system");
  assert.equal(readStoredTheme(undefined), "system");
  assert.doesNotThrow(() => writeStoredTheme(null, "dark"));
});

test("choosing light or dark writes the key", () => {
  const storage = fakeStorage();
  writeStoredTheme(storage, "dark");
  assert.equal(storage.map.get(THEME_STORAGE_KEY), "dark");
  writeStoredTheme(storage, "light");
  assert.equal(storage.map.get(THEME_STORAGE_KEY), "light");
});

test("choosing system leaves nothing behind", () => {
  // A visitor who never picks a side should not be storing anything at all.
  const storage = fakeStorage({ initial: { [THEME_STORAGE_KEY]: "dark" } });
  writeStoredTheme(storage, "system");
  assert.equal(storage.map.has(THEME_STORAGE_KEY), false);
  assert.equal(readStoredTheme(storage), "system");
});

test("a write is read back as the same choice", () => {
  for (const choice of THEME_CHOICES) {
    const storage = fakeStorage();
    writeStoredTheme(storage, choice);
    assert.equal(readStoredTheme(storage), choice, choice);
  }
});

// ------------------------------------------------------------- the attribute --

test("system removes the attribute, the others set it", () => {
  assert.equal(themeAttribute("system"), null);
  assert.equal(themeAttribute("light"), "light");
  assert.equal(themeAttribute("dark"), "dark");
});

test("the attribute reads back as the choice that set it", () => {
  for (const choice of THEME_CHOICES) {
    assert.equal(themeFromAttribute(themeAttribute(choice)), choice, choice);
  }
});

test("a missing or junk attribute means system", () => {
  for (const value of [null, undefined, "", "auto", "system", "DARK"]) {
    assert.equal(themeFromAttribute(value), "system", String(value));
  }
});

// -------------------------------------------------------------- resolving --

test("an explicit choice ignores the system preference", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("system follows the system preference", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

// ------------------------------------------------------------ boot script --

test("the boot script uses the same key the module reads", () => {
  // Typing the key twice is how the two silently stop agreeing.
  assert.ok(THEME_BOOT_SCRIPT.includes(JSON.stringify(THEME_STORAGE_KEY)));
});

test("the boot script only ever sets a real theme", () => {
  assert.match(THEME_BOOT_SCRIPT, /t==="light"\|\|t==="dark"/);
  assert.ok(!THEME_BOOT_SCRIPT.includes('"system"'), "system must leave the attribute off");
});

test("the boot script cannot throw", () => {
  // localStorage access throws outright in a locked-down browser, and an
  // uncaught throw in <head> would stop the rest of the document.
  assert.match(THEME_BOOT_SCRIPT, /^try\{/);
  assert.match(THEME_BOOT_SCRIPT, /catch\(e\)\{\}$/);
});

test("the boot script actually applies a stored choice", async () => {
  const vm = await import("node:vm");
  for (const [stored, expected] of [["dark", "dark"], ["light", "light"], [null, null], ["nonsense", null]]) {
    let applied = null;
    const context = vm.createContext({
      localStorage: { getItem: () => stored },
      document: { documentElement: { setAttribute: (_name, value) => { applied = value; } } },
    });
    vm.runInContext(THEME_BOOT_SCRIPT, context);
    assert.equal(applied, expected, `stored ${stored}`);
  }
});

test("the boot script survives storage that throws", async () => {
  const vm = await import("node:vm");
  const context = vm.createContext({
    localStorage: { getItem() { throw new Error("blocked"); } },
    document: { documentElement: { setAttribute() { throw new Error("should not be reached"); } } },
  });
  assert.doesNotThrow(() => vm.runInContext(THEME_BOOT_SCRIPT, context));
});

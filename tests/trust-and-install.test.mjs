import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/Workspace.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

const addFiles = page.slice(page.indexOf("async function addFiles"), page.indexOf("async function addFiles") + 3000);

// ------------------------------------------------------ what we promise --

test("the drop zone says what is already true: no sign-up, no watermark, no cap on uses", () => {
  assert.match(page, /ไม่ต้องสมัคร · ไม่มีลายน้ำ · ใช้ได้ไม่จำกัดครั้ง/);
});

test("the offline promise only ships together with what makes it true", () => {
  // pdf-lib and jszip are imported on first use. Without fetching them when
  // files arrive, going offline before pressing the button fails with
  // "Failed to fetch dynamically imported module" — measured, not assumed.
  assert.match(page, /เพิ่มไฟล์แล้วปิด Wi‑Fi ก็ยังทำต่อได้/);
  assert.match(addFiles, /void import\("pdf-lib"\)\.catch\(\(\) => undefined\)/);
  assert.match(addFiles, /void import\("jszip"\)\.catch\(\(\) => undefined\)/);
});

test("the code is fetched only once files are accepted, not for every visitor", () => {
  const warm = addFiles.indexOf('import("pdf-lib")');
  const validated = addFiles.indexOf("if (validationError)");
  assert.ok(validated !== -1 && warm > validated, "warm-up must come after validation passes");
});

// --------------------------------------------------- install suggestion --

test("the browser's own install banner is held back for the right moment", () => {
  assert.match(page, /addEventListener\("beforeinstallprompt", onPrompt\)/);
  assert.match(page, /event\.preventDefault\(\);\s*setInstallPrompt/);
  assert.match(page, /addEventListener\("appinstalled", onInstalled\)/);
});

test("the suggestion appears only inside a successful result", () => {
  const result = page.slice(page.indexOf('className="download-result"'), page.indexOf("{detailPage &&"));
  assert.match(result, /className="install-hint"/);
  assert.match(page, /const install = result\s*\?\s*installHint\(/);
});

test("a dismissal is remembered, and blocked storage cannot break the page", () => {
  assert.match(page, /localStorage\.setItem\(INSTALL_DISMISSED_KEY, "1"\)/);
  const read = page.slice(page.indexOf("function readInstallDismissed"), page.indexOf("function readInstallDismissed") + 200);
  assert.match(read, /try \{/);
});

test("both install controls meet the touch minimum", () => {
  for (const selector of [".install-button", ".install-dismiss"]) {
    const rule = css.match(new RegExp(`\\${selector} \\{([^}]*)\\}`))[1];
    assert.match(rule, /min-height:\s*var\(--size-touch-min\)/, selector);
  }
});

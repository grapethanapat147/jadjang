import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { idCopyLines, thaiDate } from "../app/lib/canvas-tools.ts";

const settings = await readFile(new URL("../app/ToolSettings.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../app/Workspace.tsx", import.meta.url), "utf8");

const DAY = new Date(2026, 10, 12);

test("dates are written the Thai way, in the Buddhist era", () => {
  assert.equal(thaiDate(DAY), "12 พ.ย. 2569");
});

test("an ID copy says it is a true copy, what it is for, and when", () => {
  assert.deepEqual(idCopyLines("สมัครงาน", DAY), ["สำเนาถูกต้อง", "ใช้สำหรับสมัครงานเท่านั้น", "วันที่ 12 พ.ย. 2569"]);
  // A purpose ending in a Latin name keeps a space before เท่านั้น.
  assert.equal(idCopyLines("เปิดบัญชีธนาคาร ABC", DAY)[1], "ใช้สำหรับเปิดบัญชีธนาคาร ABC เท่านั้น");
});

test("typing the words the stamp already adds does not double them", () => {
  assert.equal(idCopyLines("ใช้สำหรับ สมัครงาน เท่านั้น", DAY)[1], "ใช้สำหรับสมัครงานเท่านั้น");
});

test("no purpose, no stamp: an unlabelled copy is exactly what the bank warns about", () => {
  assert.equal(idCopyLines("   ", DAY), null);
  assert.match(workspace, /if \(!lines\) throw new Error\("กรุณาบอกว่าสำเนานี้ใช้สำหรับอะไร/);
});

test("the ID copy is the watermark tool's default, and always written large and readable", () => {
  assert.match(settings, /watermarkKind: "id-copy",/);
  assert.match(workspace, /opacity: idCopy \? 0\.5/);
});

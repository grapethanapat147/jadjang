import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  hasSignature,
  isImageOfFormat,
  readArchiveEntryCount,
} from "../app/lib/verify-output.ts";

const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function archiveTail(entryCount) {
  const zip = new JSZip();
  for (let index = 0; index < entryCount; index += 1) {
    zip.file(`page-${index}.txt`, `contents ${index}`);
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return bytes.subarray(Math.max(0, bytes.length - 1024));
}

test("recognises the image formats the converter emits", () => {
  assert.equal(isImageOfFormat(JPEG_HEAD, "jpg"), true);
  assert.equal(isImageOfFormat(PNG_HEAD, "png"), true);
});

test("rejects an image saved in the wrong format", () => {
  assert.equal(isImageOfFormat(PNG_HEAD, "jpg"), false);
  assert.equal(isImageOfFormat(JPEG_HEAD, "png"), false);
});

test("rejects empty or truncated image data", () => {
  assert.equal(isImageOfFormat(new Uint8Array(0), "jpg"), false);
  assert.equal(isImageOfFormat(JPEG_HEAD.subarray(0, 2), "jpg"), false);
  assert.equal(hasSignature(new Uint8Array([0x00]), [0x00, 0x01]), false);
});

test("counts the entries of a real archive from its tail alone", async (t) => {
  for (const entryCount of [1, 2, 17, 250]) {
    await t.test(`${entryCount} entries`, async () => {
      assert.equal(readArchiveEntryCount(await archiveTail(entryCount)), entryCount);
    });
  }
});

test("refuses a blob that is not an archive", () => {
  assert.throws(
    () => readArchiveEntryCount(Uint8Array.from({ length: 64 }, () => 0x41)),
    /ไม่สมบูรณ์/,
  );
});

test("refuses an archive whose end record was truncated away", async () => {
  const zip = new JSZip();
  zip.file("page-0.txt", "contents");
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const truncated = bytes.subarray(0, bytes.length - 22);
  assert.throws(() => readArchiveEntryCount(truncated), /ไม่สมบูรณ์/);
});

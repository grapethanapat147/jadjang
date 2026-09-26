import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../public/${name}`, import.meta.url));
const readText = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

const iconSvg = await readText("icon.svg");
const faviconSvg = await readText("favicon.svg");
const manifest = JSON.parse(await readText("manifest.webmanifest"));
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

const BRAND_BLUE = "#4263eb";
const VIEWBOX = 512;

/** The three bars, as the points the SVG actually draws. */
function markPoints(svg) {
  return [...svg.matchAll(/<path d="M ([^"]+) Z"/g)].map((m) =>
    m[1].split(" L ").map((pair) => pair.trim().split(/\s+/).map(Number)),
  );
}

// -------------------------------------------------------- the source SVG --

test("the mark is three shapes, not a rasterised blob", () => {
  const shapes = markPoints(iconSvg);
  assert.equal(shapes.length, 3, "three bars");
  for (const shape of shapes) {
    assert.equal(shape.length, 4, "each bar is a four-cornered parallelogram");
    for (const [x, y] of shape) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), "coordinates must be numbers");
    }
  }
});

test("the plate is the brand blue and the bars are white", () => {
  assert.match(iconSvg, new RegExp(`<rect[^>]*fill="${BRAND_BLUE}"`));
  assert.match(iconSvg, /fill="#ffffff"/);
});

test("the plate colour is the same one the CSS calls --blue", () => {
  const token = css.match(/--blue:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(token, "--blue must be defined");
  assert.equal(token[1].toLowerCase(), BRAND_BLUE);
});

test("the mark survives a circular maskable crop", () => {
  // Android crops a maskable icon to a circle of 80% diameter. Anything
  // outside that radius is cut off on a real phone.
  const limit = 0.4 * VIEWBOX;
  const centre = VIEWBOX / 2;
  let worst = 0;
  for (const shape of markPoints(iconSvg)) {
    for (const [x, y] of shape) {
      worst = Math.max(worst, Math.hypot(x - centre, y - centre));
    }
  }
  assert.ok(
    worst <= limit,
    `a corner reaches ${worst.toFixed(0)}px from centre, past the ${limit}px safe radius`,
  );
  // And it must not be so small that it wastes the plate.
  assert.ok(worst > limit * 0.75, `the mark only reaches ${worst.toFixed(0)}px — too small for the plate`);
});

test("the mark is centred on the plate", () => {
  // It arrived 6px left and 14px high of centre; the rebuild fixed that.
  const points = markPoints(iconSvg).flat();
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const offsetX = (Math.min(...xs) + Math.max(...xs)) / 2 - VIEWBOX / 2;
  const offsetY = (Math.min(...ys) + Math.max(...ys)) / 2 - VIEWBOX / 2;
  assert.ok(Math.abs(offsetX) < 1, `off centre by ${offsetX.toFixed(1)}px horizontally`);
  assert.ok(Math.abs(offsetY) < 1, `off centre by ${offsetY.toFixed(1)}px vertically`);
});

test("the bars stay thick enough to survive a 16px render", () => {
  // Thickness is the short edge of each parallelogram. Below about 1/16 of
  // the plate the bars merge into each other when the icon is shrunk.
  const floor = VIEWBOX / 16;
  for (const [i, shape] of markPoints(iconSvg).entries()) {
    const [a, , , d] = shape;
    const thickness = Math.hypot(d[0] - a[0], d[1] - a[1]);
    assert.ok(thickness >= floor, `bar ${i + 1} is ${thickness.toFixed(0)}px, under the ${floor}px floor`);
  }
});

// ------------------------------------------------------- the shipped set --

test("the favicon is the logo, not the template's leftover", () => {
  // public/favicon.svg shipped untouched from the starter template for months,
  // in blues that were never the brand's.
  assert.equal(faviconSvg, iconSvg, "favicon.svg must be the same mark as icon.svg");
  for (const stale of ["#68C4FF", "#0C79D8", "#2E9EFF"]) {
    assert.ok(!faviconSvg.includes(stale), `${stale} is a template colour`);
  }
});

test("every raster in the set is a real PNG at the size it claims", async () => {
  for (const [name, size] of [["icon-512.png", 512], ["icon-192.png", 192], ["apple-touch-icon.png", 180]]) {
    const bytes = await read(name);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} is not a PNG`);
    // IHDR width and height are the two big-endian ints at offset 16.
    assert.equal(bytes.readUInt32BE(16), size, `${name} width`);
    assert.equal(bytes.readUInt32BE(20), size, `${name} height`);
  }
});

test("the manifest points at the files that exist", async () => {
  for (const icon of manifest.icons) {
    const name = icon.src.replace(/^\//, "");
    await assert.doesNotReject(read(name), `${icon.src} is missing`);
    const [w, h] = icon.sizes.split("x").map(Number);
    const bytes = await read(name);
    assert.equal(bytes.readUInt32BE(16), w, `${icon.src} declares ${icon.sizes}`);
    assert.equal(bytes.readUInt32BE(20), h, `${icon.src} declares ${icon.sizes}`);
  }
  assert.ok(manifest.icons.some((i) => i.purpose?.includes("maskable")), "a maskable icon is required");
  assert.equal(manifest.theme_color.toLowerCase(), BRAND_BLUE);
});

// -------------------------------------------------------------- in the UI --

test("the header shows the logo rather than a typed letter", () => {
  assert.match(page, /<img className="brand-mark" src="\/icon\.svg"/);
  assert.ok(!page.includes('<span className="brand-mark">'), "the จ placeholder is gone");
});

test("the header mark is square, so the logo is not stretched", () => {
  const rule = css.match(/\.brand-mark \{([^}]*)\}/)[1];
  const width = rule.match(/width:\s*(\d+)px/);
  const height = rule.match(/height:\s*(\d+)px/);
  assert.ok(width && height, ".brand-mark must set both dimensions");
  assert.equal(width[1], height[1], "a square mark in a non-square box would distort it");
  // The plate is part of the artwork now.
  assert.doesNotMatch(rule, /background:/);
});

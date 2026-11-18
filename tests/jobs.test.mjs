import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { JOBS, TOOLS, toolFromPath } from "../app/lib/tools.ts";
import { TARGET_SIZES } from "../app/lib/output-builder.ts";

test("job pages have their own addresses, never a tool's", () => {
  const slugs = [...TOOLS, ...JOBS].map((page) => page.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const job of JOBS) assert.match(job.slug, /^[a-z0-9-]+$/);
});

test("a job's size preset is one the compress tool offers", () => {
  for (const job of JOBS.filter((entry) => entry.compressTarget !== undefined)) {
    assert.equal(job.tool, "compress");
    assert.ok(TARGET_SIZES.some((size) => size.bytes === job.compressTarget), job.slug);
  }
});

test("a job page opened offline still lands on its tool", () => {
  for (const job of JOBS) assert.equal(toolFromPath(`/${job.slug}`), job.tool);
});

test("every job page is in the sitemap", async () => {
  const sitemap = await readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8");
  for (const page of [...TOOLS, ...JOBS]) assert.ok(sitemap.includes(`/${page.slug}</loc>`), page.slug);
});

test("the size limit options appear only once files are in, so the preset is wired in state", async () => {
  const page = await readFile(new URL("../app/Workspace.tsx", import.meta.url), "utf8");
  assert.match(page, /useState<number \| null>\(initialJob\?\.compressTarget \?\? null\)/);
  // Picking another tool leaves the job page, so its wording must go too.
  const selectTool = page.slice(page.indexOf("function selectTool"), page.indexOf("function selectTool") + 400);
  assert.match(selectTool, /setJob\(null\)/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { REQUIRED_UI_KEYS } from "../src/locales.js";

test("inline frontend module has valid JavaScript syntax", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match, "module script is present");
  const withoutImport = match[1].replace(/^import .*;$/m, "");
  assert.doesNotThrow(() => new Function(withoutImport));
});

test("frontend references only declared localization keys", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const used = [...html.matchAll(/\bt\("([A-Za-z]+)"\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(used.filter(key => !REQUIRED_UI_KEYS.includes(key)))], []);
  assert.doesNotMatch(html, /LEGACY_(LANGS|UI)|pages\[0\]|language\s*:\s*langPrompt/);
});

test("frontend contains direction and upload accessibility hooks", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /document\.documentElement\.dir=L\.dir/);
  assert.match(html, /id="uploadMeta" aria-live="polite"/);
  assert.match(html, /setAttribute\("aria-label"/);
  assert.match(html, /reviewedOnly:!IS_LOCAL_PREVIEW/);
});

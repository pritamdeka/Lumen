import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { REQUIRED_UI_KEYS } from "../src/locales.js";

test("inline frontend module has valid JavaScript syntax", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match, "module script is present");
  const withoutImport = match[1].replace(/^import .*;$/gm, "");
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
  assert.match(html, /LOCALES\.filter\(locale=>locale\.enabled\)/);
});

test("frontend implements extraction review before explanation", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /stage:"extract"/);
  assert.match(html, /stage:"explain"/);
  assert.match(html, /id="reviewPanel"/);
  assert.match(html, /collectConfirmedExtraction/);
  assert.match(html, /item\.confidence!=="high"/);
});

test("frontend uses one accessible language picker and report dashboard", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML ids are unique");
  assert.match(html, /<dialog id="languageDialog"/);
  assert.match(html, /id="languageOptions" role="radiogroup"/);
  assert.match(html, /showModal\(\)/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="summaryViz"/);
  assert.match(html, /id="trends"/);
  assert.doesNotMatch(html, /id="langChips"|const ICONS=|✅|⚠️|🚨|content:"\\2713"/);
});

test("frontend includes visit toolkit accessibility fallbacks", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /speechSynthesis/);
  assert.match(html, /speechUnavailable/);
  assert.match(html, /createReminderIcs/);
  assert.match(html, /type="date"/);
  assert.match(html, /setAttribute\("role","img"\)/);
  assert.match(html, /className="data-table"/);
});

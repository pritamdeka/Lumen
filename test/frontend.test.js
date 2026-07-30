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
  assert.doesNotMatch(html, /\b(res|response)\.json\(\)/);
  assert.match(html, /postAnalysis\(fetch,"\/api\/analyze",payload\)/);
});

test("frontend contains direction and upload accessibility hooks", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /document\.documentElement\.dir=L\.dir/);
  assert.match(html, /id="uploadMeta" aria-live="polite"/);
  assert.match(html, /setAttribute\("aria-label"/);
  assert.match(html, /const LANGS=getProductionLocales\(\)/);
});

test("frontend requires processing consent and links every beta trust page", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="processingDialog"/);
  assert.match(html, /if\(!await ensureProcessingConsent\(\)\)/);
  assert.match(html, /async function analyse\(\)[\s\S]*?ensureProcessingConsent\(\)[\s\S]*?prepareImages\(\)/);
  assert.match(html, /localStorage\.removeItem\("lumen_processing_consent"\)/);
  for (const page of ["privacy.html", "terms.html", "medical-disclaimer.html", "contact.html"]) {
    assert.match(html, new RegExp(page.replace(".", "\\.")));
    const content = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(content, /KhyontekAI|Lumen/);
    assert.match(content, /noindex,nofollow,noarchive/);
  }
  const privacy = await readFile(new URL("../privacy.html", import.meta.url), "utf8");
  assert.match(privacy, /contact@khyontekai\.com/);
});

test("frontend explains extracted values without a blocking confidence review", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /stage:"extract"/);
  assert.match(html, /stage:"explain"/);
  assert.match(html, /await requestExplanation\(json\.extraction\)/);
  assert.doesNotMatch(html, /id="reviewPanel"|collectConfirmedExtraction|renderReview|confirmReview/);
});

test("frontend uses one accessible language picker and report dashboard", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML ids are unique");
  assert.match(html, /<dialog id="languageDialog"/);
  assert.match(html, /id="languageOptions" role="radiogroup"/);
  assert.match(html, /id="langChips"/);
  assert.match(html, /function renderLangChips\(\)/);
  assert.match(html, /activeTab=document\.querySelector\('\.report-tab\[aria-selected="true"\]'\)/);
  assert.match(html, /activateTab\(activeTab\);window\.scrollTo\(\{top:scrollTop\}\)/);
  assert.match(html, /\[\["all","all"\],\["outside","outsideRange"\],\["uncertain","uncertain"\],\["confirmed","confirmed"\]\]/);
  assert.match(html, /showModal\(\)/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="summaryViz"/);
  assert.match(html, /id="trends"/);
  assert.doesNotMatch(html, /const ICONS=|✅|⚠️|🚨|content:"\\2713"/);
});

test("frontend includes visit toolkit accessibility fallbacks", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /speechSynthesis/);
  assert.match(html, /speechUnavailable/);
  assert.match(html, /createReminderIcs/);
  assert.match(html, /type="date"/);
  assert.match(html, /setAttribute\("role","img"\)/);
  assert.match(html, /className="data-table"/);
  assert.match(html, /fetch\("\/api\/speech"/);
  assert.match(html, /id="audioProgress"/);
  assert.match(html, /lumen_speech_consent/);
  assert.match(html, /id="expandAllBtn"/);
  assert.match(html, /id="attentionJump"/);
});

test("frontend recognizes controlled analysis timeout responses", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /analysis_timeout:"analysisTimeout"/);
  assert.match(html, /localized\.code=error\?\.code/);
  assert.match(html, /buildExplanationTimeoutReport\(extracted,currentLang/);
  assert.match(html, /id="retryExplanationBtn"/);
  assert.match(html, /retryExplanationBtn"\)\.onclick=\(\)=>\{if\(lastExtraction\)requestExplanation\(lastExtraction\)/);
  assert.match(html, /r\.explanationTimedOut\?"inline-flex":"none"/);
});

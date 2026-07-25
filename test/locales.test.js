import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  getEnabledLocales,
  getLocale,
  getProductionLocales,
  hasExpectedScript,
  isProductionLocale,
  LOCALES,
  REQUIRED_UI_KEYS,
  translate
} from "../src/locales.js";
import { catalogHash } from "../src/translation-review.js";
import { SCRIPT_FIXTURES } from "../test-fixtures/scripts.js";

const EXPECTED_PRODUCTION_LOCALES = [
  "en", "hi", "bn", "as", "ta", "te", "mr", "kn", "gu",
  "ml", "pa", "or", "ur", "es", "fr", "de", "it", "pt-PT"
];

test("defines 18 unique locale catalogs and keeps approvals explicit", () => {
  assert.equal(LOCALES.length, 18);
  assert.equal(new Set(LOCALES.map(locale => locale.code)).size, 18);
  assert.ok(getEnabledLocales().length >= 13);
  assert.ok(LOCALES.filter(locale => locale.reviewed).every(locale => locale.enabled));
});

test("the immediate beta exposes all 18 approved locale catalogs", () => {
  assert.deepEqual(getProductionLocales().map(locale => locale.code), EXPECTED_PRODUCTION_LOCALES);
  assert.equal(getProductionLocales().length, 18);
  for (const locale of LOCALES) {
    assert.equal(locale.enabled, true, `${locale.code} is enabled`);
    assert.equal(locale.reviewed, true, `${locale.code} has a current review`);
    assert.equal(locale.review.status, "approved", `${locale.code} is approved`);
    assert.equal(
      locale.review.catalogHash,
      catalogHash(locale.ui, REQUIRED_UI_KEYS),
      `${locale.code} review checksum matches its active catalog`
    );
    assert.equal(Number.isNaN(Date.parse(locale.review.reviewedAt)), false, `${locale.code} has a valid review timestamp`);
    if (locale.code === "en") {
      assert.equal(locale.review.method, "project-baseline");
    } else {
      assert.equal(locale.review.method, "deepinfra-dual-model");
      assert.deepEqual(locale.review.reviewers, [
        "google/gemma-4-26B-A4B-it",
        "Qwen/Qwen3.6-35B-A3B"
      ]);
      assert.equal(locale.review.adjudicator, "google/gemma-4-31B-it");
    }
  }
});

test("every locale provides every required UI string", () => {
  for (const locale of LOCALES) {
    assert.deepEqual(
      REQUIRED_UI_KEYS.filter(key => typeof locale.ui[key] !== "string" || !locale.ui[key].trim()),
      [],
      `${locale.code} has missing UI strings`
    );
  }
});

test("supported locales do not fall back to English", () => {
  for (const locale of LOCALES.filter(item => item.code !== DEFAULT_LOCALE)) {
    for (const key of REQUIRED_UI_KEYS) assert.equal(translate(locale.code, key), locale.ui[key]);
  }
  assert.equal(translate("unknown", "explain"), getLocale("en").ui.explain);
});

test("locale metadata has the expected writing direction and script", () => {
  for (const locale of LOCALES) {
    assert.ok(locale.prompt);
    assert.ok(locale.script);
    const fixture = SCRIPT_FIXTURES[locale.code] || locale.ui.heroTitle;
    assert.equal(hasExpectedScript(fixture, locale.code), true, locale.code);
    assert.equal(locale.dir, locale.code === "ur" ? "rtl" : "ltr");
  }
});

test("production filtering exposes only current approved catalogs", () => {
  assert.ok(isProductionLocale("en"));
  assert.deepEqual(getEnabledLocales({ reviewedOnly: true }).map(locale => locale.code), getProductionLocales().map(locale => locale.code));
  for (const locale of LOCALES) assert.equal(isProductionLocale(locale.code), locale.enabled && locale.reviewed);
});

test("localized clinical status labels are present", () => {
  for (const locale of LOCALES) {
    for (const key of ["normal", "low", "high", "borderline", "critical"]) {
      assert.ok(locale.ui[key]);
    }
  }
});

test("Assamese has a specific analysis-timeout message", () => {
  assert.equal(translate("as", "analysisTimeout"), "বিশ্লেষণত আশা কৰাতকৈ বেছি সময় লাগিছে। অনুগ্ৰহ কৰি পুনৰ চেষ্টা কৰক।");
  assert.notEqual(translate("as", "analysisTimeout"), translate("as", "requestFailed"));
});

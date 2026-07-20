import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  getEnabledLocales,
  getLocale,
  hasExpectedScript,
  LOCALES,
  REQUIRED_UI_KEYS,
  translate
} from "../src/locales.js";
import { SCRIPT_FIXTURES } from "../test-fixtures/scripts.js";

test("defines 13 enabled and five draft European locales", () => {
  assert.equal(LOCALES.length, 18);
  assert.equal(new Set(LOCALES.map(locale => locale.code)).size, 18);
  assert.equal(getEnabledLocales().length, 13);
  assert.deepEqual(LOCALES.filter(locale => !locale.enabled).map(locale => locale.code), ["es", "fr", "de", "it", "pt-PT"]);
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

test("review filtering exposes only signed-off translations", () => {
  assert.deepEqual(getEnabledLocales({ reviewedOnly: true }).map(locale => locale.code), ["en"]);
  assert.equal(LOCALES.filter(locale => !locale.reviewed).length, 17);
});

test("localized clinical status labels are present", () => {
  for (const locale of LOCALES) {
    for (const key of ["normal", "low", "high", "borderline", "critical"]) {
      assert.ok(locale.ui[key]);
    }
  }
});

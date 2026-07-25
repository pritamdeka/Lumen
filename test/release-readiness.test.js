import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LOCALES } from "../src/locales.js";

test("local review credentials and paid-call cache are ignored", async () => {
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  const ignored = new Set(gitignore.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  assert.equal(ignored.has("key.txt"), true);
  assert.equal(ignored.has(".env.local"), true);
  assert.equal(ignored.has(".translation-review-cache"), true);
});

test("translation audit lists every locale as approved without raw provider data", async () => {
  const audit = await readFile(new URL("../docs/translation-review.md", import.meta.url), "utf8");
  assert.match(audit, /AI\/API review/);
  assert.match(audit, /not represented as native-human review/);
  for (const locale of LOCALES) {
    assert.match(audit, new RegExp(`\\| \`${locale.code.replace("-", "\\-")}\` \\|[^\\n]+\\| approved \\|`));
  }
  assert.doesNotMatch(audit, /DEEPINFRA_API_KEY|Bearer\s+[A-Za-z0-9._-]+|choices"\s*:/);
});

test("review runner supports local key.txt without logging credentials or report content", async () => {
  const source = await readFile(new URL("../scripts/review-translations.js", import.meta.url), "utf8");
  assert.match(source, /key\.txt/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:apiKey|DEEPINFRA_API_KEY)/i);
  assert.doesNotMatch(source, /api\/analyze|sourceText|findingId|reportType/);
});

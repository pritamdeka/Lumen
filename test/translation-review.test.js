import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeReviewItems,
  parseReviewObject,
  placeholders,
  reviewLocaleCatalog,
  validateCatalog
} from "../src/translation-review-core.js";
import { catalogHash, sha256Hex } from "../src/translation-review.js";
import { cachedDeepInfraRequest } from "../scripts/review-translations.js";

const locale = { code: "es", prompt: "Spanish in Latin script", script: "Latin", dir: "ltr" };
const items = (verdict, correction = "") => ({ items: [{ key: "message", verdict, correction, issues: [] }] });

test("SHA-256 and catalog hashing are deterministic", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(catalogHash({ b: "two", a: "one" }, ["a", "b"]), catalogHash({ a: "one", b: "two" }, ["b", "a"]));
  assert.notEqual(catalogHash({ a: "one" }, ["a"]), catalogHash({ a: "two" }, ["a"]));
});

test("catalog validation preserves required keys and placeholders", () => {
  assert.deepEqual(placeholders("Open {{name}} and %s"), ["{{name}}", "%s"]);
  assert.deepEqual(validateCatalog({ message: "Hello {{name}}" }, { message: "Hola {{name}}" }, ["message"]), []);
  assert.match(validateCatalog({ message: "Hello {{name}}" }, { message: "Hola" }, ["message"]).join(" "), /placeholders changed/);
  assert.match(validateCatalog({ message: "Hello" }, {}, ["message"]).join(" "), /missing/);
});

test("review JSON and item validation reject malformed provider output", () => {
  assert.deepEqual(parseReviewObject('```json\n{"items":[]}\n```'), { items: [] });
  assert.equal(normalizeReviewItems(items("pass"), ["message"]).get("message").verdict, "pass");
  assert.throws(() => normalizeReviewItems({ items: [] }, ["message"]), /count mismatch/);
  assert.throws(() => normalizeReviewItems(items("fix"), ["message"]), /correction is missing/);
});

test("dual-review agreement approves without adjudication", async () => {
  const models = [];
  const result = await reviewLocaleCatalog({
    locale, source: { message: "Hello" }, target: { message: "Hola" }, requiredKeys: ["message"],
    request: async model => { models.push(model); return items("pass"); }
  });
  assert.equal(result.status, "approved");
  assert.equal(result.corrections, 0);
  assert.equal(models.length, 2);
});

test("a disputed translation is adjudicated, repaired, and rechecked", async () => {
  let adjudications = 0;
  let reviewRound = 0;
  const result = await reviewLocaleCatalog({
    locale, source: { message: "Hello" }, target: { message: "Ola" }, requiredKeys: ["message"],
    request: async (model, prompt) => {
      if (prompt.includes("final translation adjudicator")) {
        adjudications++;
        return items("fix", "Hola");
      }
      if (model.includes("gemma-4-26B")) {
        reviewRound++;
        return reviewRound === 1 ? items("fix", "Hola") : items("pass");
      }
      return items("pass");
    }
  });
  assert.equal(result.status, "approved");
  assert.equal(result.catalog.message, "Hola");
  assert.equal(result.corrections, 1);
  assert.equal(adjudications, 1);
});

test("blocked and non-converging translations remain failed", async () => {
  const blocked = await reviewLocaleCatalog({
    locale, source: { message: "Hello" }, target: { message: "Ola" }, requiredKeys: ["message"],
    request: async (_model, prompt) => prompt.includes("final translation adjudicator") ? items("block") : items("fix", "Hola")
  });
  assert.equal(blocked.status, "failed");
  assert.match(blocked.reason, /blocked release/);

  let correction = 0;
  const changing = await reviewLocaleCatalog({
    locale, source: { message: "Hello" }, target: { message: "Ola" }, requiredKeys: ["message"], maxRepairRounds: 1,
    request: async (_model, prompt) => {
      if (!prompt.includes("final translation adjudicator")) return items("fix", "candidate");
      correction++;
      return items("fix", `Hola ${correction}`);
    }
  });
  assert.equal(changing.status, "failed");
  assert.match(changing.reason, /did not pass/);
});

test("translation reviewer never reads or sends report data", async () => {
  const source = await readFile(new URL("../scripts/review-translations.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /api\/analyze|lumen_hist|reportType|sourceText|findingId/);
  assert.match(source, /DEEPINFRA_API_KEY/);
  assert.doesNotMatch(source, /console\.log\(.*API_KEY/);
});

test("DeepInfra review retries rate limits and resumes from its cache", async () => {
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "lumen-translation-review-"));
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429 };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(items("pass")) } }] })
    };
  };
  try {
    const first = await cachedDeepInfraRequest("test-model", "test-prompt", {
      apiKey: "test-key",
      cacheDirectory,
      fetchImpl,
      sleepImpl: async () => {}
    });
    assert.equal(first.items[0].verdict, "pass");
    assert.equal(calls, 2);
    const second = await cachedDeepInfraRequest("test-model", "test-prompt", {
      apiKey: "test-key",
      cacheDirectory,
      fetchImpl: async () => { throw new Error("cache was not used"); }
    });
    assert.deepEqual(second, first);
    assert.equal(calls, 2);
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test("DeepInfra review rejects malformed model responses", async () => {
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "lumen-translation-review-invalid-"));
  try {
    await assert.rejects(
      cachedDeepInfraRequest("test-model", "invalid-prompt", {
        apiKey: "test-key",
        cacheDirectory,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "not json" } }] })
        }),
        sleepImpl: async () => {}
      }),
      /Invalid translation review JSON/
    );
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

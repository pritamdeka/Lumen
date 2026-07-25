import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  mapWithConcurrency,
  normalizeReviewItems,
  parseReviewObject,
  placeholders,
  reviewLocaleCatalog,
  validateCatalog
} from "../src/translation-review-core.js";
import { catalogHash, sha256Hex } from "../src/translation-review.js";
import {
  cachedDeepInfraRequest,
  reviewResponseFormat,
  translationReviewCacheKey
} from "../scripts/review-translations.js";

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

test("bounded workers preserve order without exceeding concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(maximum, 2);
});

test("bounded workers stop assigning work and drain siblings after a failure", async () => {
  const started = [];
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  await assert.rejects(
    mapWithConcurrency([1, 2, 3, 4], 2, async value => {
      started.push(value);
      if (started.length === 2) release();
      await ready;
      if (value === 1) throw new Error("worker failed");
      await new Promise(resolve => setTimeout(resolve, 2));
      return value;
    }),
    /worker failed/
  );
  assert.deepEqual(started, [1, 2]);
});

test("review JSON and item validation reject malformed provider output", () => {
  assert.deepEqual(parseReviewObject('```json\n{"items":[]}\n```'), { items: [] });
  assert.equal(normalizeReviewItems(items("pass"), ["message"]).get("message").verdict, "pass");
  assert.throws(() => normalizeReviewItems({ items: [] }, ["message"]), /count mismatch/);
  assert.throws(() => normalizeReviewItems(items("fix"), ["message"]), /correction is missing/);
});

test("review response schemas constrain count, keys, and required fields", () => {
  const format = reviewResponseFormat(["first", "second"]);
  const itemsSchema = format.json_schema.schema.properties.items;
  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.strict, true);
  assert.equal(itemsSchema.minItems, 2);
  assert.equal(itemsSchema.maxItems, 2);
  assert.deepEqual(itemsSchema.items.properties.key.enum, ["first", "second"]);
  assert.deepEqual(itemsSchema.items.required, ["key", "verdict", "correction", "issues"]);
  assert.equal(itemsSchema.items.additionalProperties, false);
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

test("blocked translations fail while the final adjudicator can settle stylistic churn", async () => {
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
  assert.equal(changing.status, "approved");
  assert.equal(changing.catalog.message, "Hola 2");
});

test("a failed reviewer batch is recursively split without dropping keys", async () => {
  let qwenCalls = 0;
  const result = await reviewLocaleCatalog({
    locale,
    source: { first: "First", second: "Second" },
    target: { first: "Primero", second: "Segundo" },
    requiredKeys: ["first", "second"],
    chunkSize: 2,
    concurrency: 1,
    request: async (model, prompt) => {
      const keys = prompt.includes('"key":"item"')
        ? ["item"]
        : ["first", "second"].filter(key => prompt.includes(`"key":"${key}"`));
      if (model.includes("Qwen")) {
        qwenCalls++;
        if (keys.length > 1) throw new Error("batch too large");
      }
      return { items: keys.map(key => ({ key, verdict: "pass", correction: "", issues: [] })) };
    }
  });
  assert.equal(result.status, "approved");
  assert.equal(qwenCalls, 3);
  assert.deepEqual(result.catalog, { first: "Primero", second: "Segundo" });
});

test("a failed adjudicator batch is recursively split without dropping decisions", async () => {
  let adjudicatorCalls = 0;
  const result = await reviewLocaleCatalog({
    locale,
    source: { first: "First", second: "Second" },
    target: { first: "Primero", second: "Segundo" },
    requiredKeys: ["first", "second"],
    chunkSize: 2,
    adjudicationChunkSize: 2,
    concurrency: 1,
    request: async (model, prompt) => {
      const keys = prompt.includes('"key":"item"')
        ? ["item"]
        : ["first", "second"].filter(key => prompt.includes(`"key":"${key}"`));
      if (model.includes("gemma-4-31B")) {
        adjudicatorCalls++;
        if (keys.length > 1) throw new Error("adjudication batch too large");
        return { items: keys.map(key => ({ key, verdict: "pass", correction: "", issues: [] })) };
      }
      return { items: keys.map(key => ({ key, verdict: "fix", correction: key === "first" ? "Primero" : "Segundo", issues: [] })) };
    }
  });
  assert.equal(result.status, "approved");
  assert.equal(adjudicatorCalls, 3);
  assert.deepEqual(result.catalog, { first: "Primero", second: "Segundo" });
});

test("an invalid adjudicator batch is validated and split before corrections are applied", async () => {
  let adjudicatorCalls = 0;
  const result = await reviewLocaleCatalog({
    locale,
    source: { first: "First", second: "Second" },
    target: { first: "Primero", second: "Segundo" },
    requiredKeys: ["first", "second"],
    chunkSize: 2,
    adjudicationChunkSize: 2,
    concurrency: 1,
    request: async (model, prompt) => {
      const keys = prompt.includes('"key":"item"')
        ? ["item"]
        : ["first", "second"].filter(key => prompt.includes(`"key":"${key}"`));
      if (model.includes("gemma-4-31B")) {
        adjudicatorCalls++;
        if (keys.length > 1) {
          return { items: keys.map(key => ({ key, verdict: "fix", correction: "", issues: [] })) };
        }
        return { items: keys.map(key => ({ key, verdict: "pass", correction: "", issues: [] })) };
      }
      return { items: keys.map(key => ({ key, verdict: "fix", correction: key === "first" ? "Primero" : "Segundo", issues: [] })) };
    }
  });
  assert.equal(result.status, "approved");
  assert.equal(adjudicatorCalls, 3);
  assert.deepEqual(result.catalog, { first: "Primero", second: "Segundo" });
});

test("a reviewer fix without replacement is unresolved and must be adjudicated", async () => {
  let adjudicatorCalls = 0;
  const result = await reviewLocaleCatalog({
    locale,
    source: { message: "Hello" },
    target: { message: "Hola" },
    requiredKeys: ["message"],
    request: async (model) => {
      if (model.includes("gemma-4-31B")) {
        adjudicatorCalls++;
        return items("pass");
      }
      if (model.includes("Qwen")) return items("fix", "");
      return items("pass");
    }
  });
  assert.equal(result.status, "approved");
  assert.equal(adjudicatorCalls, 1);
  assert.equal(result.catalog.message, "Hola");
});

test("single-key adjudication uses an anonymous item and remaps the strict response", async () => {
  const result = await reviewLocaleCatalog({
    locale,
    source: { uploadHint: "Upload a report" },
    target: { uploadHint: "Sube un informe" },
    requiredKeys: ["uploadHint"],
    request: async (model, prompt) => {
      if (!model.includes("gemma-4-31B")) return { items: [{ key: "uploadHint", verdict: "fix", correction: "Carga un informe", issues: [] }] };
      assert.match(prompt, /"key":"item"/);
      assert.doesNotMatch(prompt, /"key":"uploadHint"/);
      return { items: [{ key: "item", verdict: "fix", correction: "Carga un informe", issues: [] }] };
    }
  });
  assert.equal(result.status, "approved");
  assert.equal(result.catalog.uploadHint, "Carga un informe");
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

test("DeepInfra requests apply the selected schema and output budget", async () => {
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "lumen-translation-review-schema-"));
  let requestBody;
  try {
    await cachedDeepInfraRequest("test-model", "schema-prompt", {
      apiKey: "test-key",
      cacheDirectory,
      maxTokens: 600,
      responseFormat: reviewResponseFormat(["message"]),
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: JSON.stringify(items("pass")) } }] })
        };
      }
    });
    assert.equal(requestBody.max_tokens, 600);
    assert.equal(requestBody.response_format.type, "json_schema");
    assert.equal(requestBody.response_format.json_schema.schema.properties.items.maxItems, 1);
    assert.equal(requestBody.reasoning_effort, "none");
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

test("DeepInfra review discards an invalid cached envelope and refetches", async () => {
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "lumen-translation-review-stale-"));
  const model = "test-model";
  const prompt = "stale-prompt";
  const cacheKey = translationReviewCacheKey(model, prompt);
  await writeFile(path.join(cacheDirectory, `${cacheKey}.json`), '{"wrong":[]}\n', "utf8");
  let calls = 0;
  try {
    const response = await cachedDeepInfraRequest(model, prompt, {
      apiKey: "test-key",
      cacheDirectory,
      fetchImpl: async () => {
        calls++;
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(items("pass")) } }] }) };
      }
    });
    assert.equal(response.items[0].verdict, "pass");
    assert.equal(calls, 1);
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test("DeepInfra review aborts a stalled model request", async () => {
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "lumen-translation-review-timeout-"));
  try {
    await assert.rejects(
      cachedDeepInfraRequest("test-model", "stalled-prompt", {
        apiKey: "test-key",
        cacheDirectory,
        timeoutMs: 5,
        retryDelaysMs: [],
        fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })
      }),
      /aborted/
    );
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

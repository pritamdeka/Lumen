import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCALE,
  getLocale,
  hasExpectedScript,
  LOCALES,
  REQUIRED_UI_KEYS
} from "../src/locales.js";
import { TRANSLATION_OVERRIDES } from "../src/translation-overrides.js";
import { TRANSLATION_REVIEWS } from "../src/translation-review-data.js";
import {
  mapWithConcurrency,
  normalizeReviewItems,
  parseReviewObject,
  reviewLocaleCatalog,
  TRANSLATION_REVIEW_MODELS,
  validateCatalog
} from "../src/translation-review-core.js";
import { catalogHash, sha256Hex } from "../src/translation-review.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, ".translation-review-cache");
const REVIEW_DATA_PATH = path.join(ROOT, "src", "translation-review-data.js");
const OVERRIDES_PATH = path.join(ROOT, "src", "translation-overrides.js");
const CHECKLIST_PATH = path.join(ROOT, "docs", "translation-review.md");
const DEEPINFRA_URL = "https://api.deepinfra.com/v1/openai/chat/completions";
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
const RATE_LIMIT_DELAYS_MS = [30_000, 60_000, 60_000];
const REQUEST_TIMEOUT_MS = 45_000;
const QWEN_REQUEST_INTERVAL_MS = 5_000;
let qwenRequestQueue = Promise.resolve();
let lastQwenRequestAt = 0;

function parseArguments(argv) {
  const localeArg = argv.find(value => value.startsWith("--locale="));
  return {
    check: argv.includes("--check"),
    probe: argv.includes("--probe"),
    force: argv.includes("--force"),
    locale: localeArg ? localeArg.slice("--locale=".length) : null
  };
}

async function loadLocalEnvironment() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = await readFile(path.join(ROOT, filename), "utf8");
      for (const rawLine of content.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const separator = line.indexOf("=");
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!process.env.DEEPINFRA_API_KEY) {
    try {
      const key = (await readFile(path.join(ROOT, "key.txt"), "utf8")).trim();
      if (key) process.env.DEEPINFRA_API_KEY = key;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForProviderSlot(model, sleepImpl) {
  if (!model.includes("Qwen/")) return;
  let release;
  const previous = qwenRequestQueue;
  qwenRequestQueue = new Promise(resolve => { release = resolve; });
  await previous;
  const wait = Math.max(0, lastQwenRequestAt + QWEN_REQUEST_INTERVAL_MS - Date.now());
  if (wait) await sleepImpl(wait);
  lastQwenRequestAt = Date.now();
  release();
}

function isReviewEnvelope(value) {
  return value && Array.isArray(value.items) && value.items.every(item =>
    item && typeof item.key === "string" && ["pass", "fix", "block"].includes(item.verdict)
  );
}

function isStrictReviewEnvelope(value) {
  return isReviewEnvelope(value) && value.items.every(item =>
    item.verdict !== "fix" || (typeof item.correction === "string" && item.correction.trim())
  );
}

export function reviewResponseFormat(expectedKeys) {
  return {
    type: "json_schema",
    json_schema: {
      name: "translation_review",
      strict: true,
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: expectedKeys.length,
            maxItems: expectedKeys.length,
            items: {
              type: "object",
              properties: {
                key: { type: "string", enum: expectedKeys },
                verdict: { type: "string", enum: ["pass", "fix", "block"] },
                correction: { type: "string" },
                issues: { type: "array", items: { type: "string" }, maxItems: 8 }
              },
              required: ["key", "verdict", "correction", "issues"],
              additionalProperties: false
            }
          }
        },
        required: ["items"],
        additionalProperties: false
      }
    }
  };
}

function promptKeys(prompt) {
  const marker = prompt.includes("Disputed items:\n") ? "Disputed items:\n" : "Interface strings:\n";
  const start = prompt.lastIndexOf(marker);
  if (start < 0) return [];
  try {
    const entries = JSON.parse(prompt.slice(start + marker.length));
    return [...new Set(entries.map(entry => entry?.key).filter(key => typeof key === "string"))];
  } catch {
    return [];
  }
}

export function translationReviewCacheKey(model, prompt) {
  return sha256Hex(JSON.stringify({
    version: 2,
    model,
    prompt,
    reasoningEffort: "none",
    maxTokens: 4_000
  }));
}

export async function cachedDeepInfraRequest(model, prompt, options = {}) {
  const cacheDirectory = options.cacheDirectory || CACHE_DIR;
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || sleep;
  const apiKey = options.apiKey || process.env.DEEPINFRA_API_KEY;
  const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
  const retryDelays = options.retryDelaysMs || RETRY_DELAYS_MS;
  const validateEnvelope = options.validateEnvelope || isReviewEnvelope;
  const maxTokens = options.maxTokens || 4_000;
  const responseFormat = options.responseFormat || { type: "json_object" };
  if (!apiKey) throw new Error("DEEPINFRA_API_KEY is required");
  const cacheKey = translationReviewCacheKey(model, prompt);
  const cachePath = path.join(cacheDirectory, `${cacheKey}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (validateEnvelope(cached)) return cached;
    await unlink(cachePath);
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    if (error instanceof SyntaxError) await unlink(cachePath).catch(() => {});
  }

  const body = {
    model,
    messages: [
      { role: "system", content: "Return only the requested JSON. Do not include hidden reasoning, Markdown, or commentary." },
      { role: "user", content: prompt }
    ],
    response_format: responseFormat,
    reasoning_effort: "none",
    temperature: 0.1,
    max_tokens: maxTokens
  };

  let lastError;
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    await waitForProviderSlot(model, sleepImpl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(DEEPINFRA_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const error = new Error(`DeepInfra translation review failed with HTTP ${response.status}`);
        error.retryable = retryable;
        error.status = response.status;
        const retryAfter = Number(response.headers?.get?.("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          error.retryAfterMs = Math.min(60_000, retryAfter * 1_000);
        }
        throw error;
      }
      const envelope = await response.json();
      const content = envelope?.choices?.[0]?.message?.content;
      const parsed = parseReviewObject(content);
      if (!validateEnvelope(parsed)) {
        const error = new Error("DeepInfra returned an invalid translation review envelope");
        error.retryable = true;
        throw error;
      }
      await mkdir(cacheDirectory, { recursive: true });
      await writeFile(cachePath, `${JSON.stringify(parsed)}\n`, "utf8");
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt >= retryDelays.length || error.retryable === false) break;
      const delay = error.status === 429
        ? Math.max(
            error.retryAfterMs || 0,
            RATE_LIMIT_DELAYS_MS[Math.min(attempt, RATE_LIMIT_DELAYS_MS.length - 1)]
          )
        : retryDelays[attempt];
      await sleepImpl(delay);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function probeModels() {
  const prompt = 'Structured-output schema probe v1. Return a passing review item for the key "probe".';
  for (const model of [...TRANSLATION_REVIEW_MODELS.reviewers, TRANSLATION_REVIEW_MODELS.adjudicator]) {
    const response = await cachedDeepInfraRequest(model, prompt, {
      maxTokens: 200,
      responseFormat: reviewResponseFormat(["probe"])
    });
    const item = response?.items?.[0];
    if (item?.key !== "probe" || item?.verdict !== "pass") throw new Error(`${model} returned an invalid probe response`);
    console.log(`${model}: available`);
  }
}

function staticCatalogErrors(locale, catalog) {
  const errors = validateCatalog(getLocale(DEFAULT_LOCALE).ui, catalog, REQUIRED_UI_KEYS);
  if (!hasExpectedScript(Object.values(catalog).join(" "), locale.code)) {
    errors.push(`${locale.code}: expected ${locale.script} script is missing`);
  }
  return errors;
}

function reviewModule(records) {
  return `// Generated by scripts/review-translations.js. Do not add credentials or model responses.\nexport const TRANSLATION_REVIEWS = ${JSON.stringify(records, null, 2)};\n`;
}

function overridesModule(overrides) {
  return `// Generated by scripts/review-translations.js. Only approved corrections belong here.\nexport const TRANSLATION_OVERRIDES = ${JSON.stringify(overrides, null, 2)};\n`;
}

function checklist(records) {
  const lines = [
    "# Translation Review Checklist",
    "",
    "Production activation is determined by an auditable AI/API review and a matching SHA-256 catalog checksum. These records are not represented as native-human review. Human feedback remains welcome after release.",
    "",
    `Reviewers: \`${TRANSLATION_REVIEW_MODELS.reviewers[0]}\`, \`${TRANSLATION_REVIEW_MODELS.reviewers[1]}\`  `,
    `Adjudicator: \`${TRANSLATION_REVIEW_MODELS.adjudicator}\``,
    "",
    "| Locale | Language | Method | Date | Corrections | Status | Catalog SHA-256 |",
    "|---|---|---|---|---:|---|---|"
  ];
  for (const locale of LOCALES) {
    const record = records[locale.code] || {};
    const date = record.reviewedAt ? record.reviewedAt.slice(0, 10) : "—";
    const hash = record.catalogHash ? `\`${record.catalogHash.slice(0, 12)}…\`` : "—";
    lines.push(`| \`${locale.code}\` | ${locale.label} | ${record.method || "—"} | ${date} | ${record.corrections || 0} | ${record.status || "draft"} | ${hash} |`);
  }
  lines.push(
    "",
    "Automated release checks cover:",
    "",
    "- Complete interface-key coverage with no changed placeholders.",
    "- Natural, calm, medically neutral wording without diagnosis or treatment claims.",
    "- Status labels, validation messages, controls, consent, privacy, and safety disclaimers.",
    "- Expected writing system, Urdu direction, numbers, units, file types, and medical abbreviations.",
    "- Accessibility-label intent and concise mobile-friendly wording.",
    "",
    "A catalog edit changes its checksum and immediately removes that locale from production until this review is run again."
  );
  return `${lines.join("\n")}\n`;
}

async function writeReviewArtifacts(records, overrides) {
  await writeFile(OVERRIDES_PATH, overridesModule(overrides), "utf8");
  await writeFile(REVIEW_DATA_PATH, reviewModule(records), "utf8");
  await writeFile(CHECKLIST_PATH, checklist(records), "utf8");
}

async function checkCatalogs() {
  let failures = 0;
  for (const locale of LOCALES) {
    const errors = staticCatalogErrors(locale, locale.ui);
    if (errors.length) {
      failures++;
      console.error(`${locale.code}: ${errors.join("; ")}`);
    }
  }
  const production = LOCALES.filter(locale => locale.reviewed).map(locale => locale.code);
  console.log(`Checked ${LOCALES.length} locale catalogs; production locales: ${production.join(", ") || "none"}.`);
  if (failures) process.exitCode = 1;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.check) {
    await checkCatalogs();
    return;
  }
  await loadLocalEnvironment();
  if (!process.env.DEEPINFRA_API_KEY) {
    throw new Error("DEEPINFRA_API_KEY is required in key.txt, .env.local, or the process environment");
  }
  if (options.probe) {
    await probeModels();
    return;
  }

  const selected = LOCALES.filter(locale =>
    locale.code !== DEFAULT_LOCALE
    && (!options.locale || locale.code === options.locale)
    && (options.force || !locale.reviewed)
  );
  if (!selected.length) throw new Error(`No reviewable locale matched ${options.locale || "the requested scope"}`);

  const source = getLocale(DEFAULT_LOCALE).ui;
  const records = { ...TRANSLATION_REVIEWS };
  const overrides = { ...TRANSLATION_OVERRIDES };
  let artifactWrite = Promise.resolve();
  const checkpointReviewArtifacts = () => {
    artifactWrite = artifactWrite.then(() => writeReviewArtifacts(records, overrides));
    return artifactWrite;
  };
  await mapWithConcurrency(selected, 1, async locale => {
    console.log(`Reviewing ${locale.code} (${locale.label})...`);
    let localeRequest = 0;
    const requestWithProgress = async (model, prompt) => {
      const requestNumber = ++localeRequest;
      const phase = prompt.includes("final translation adjudicator") ? "adjudicate" : "review";
      const requestKeys = promptKeys(prompt);
      const keySummary = requestKeys.length <= 3 ? ` [${requestKeys.join(", ")}]` : ` [${requestKeys.length} keys]`;
      console.log(`${locale.code}: ${phase} request ${requestNumber}${keySummary} with ${model}`);
      try {
        const maxTokens = requestKeys.length <= 3
          ? 600
          : phase === "adjudicate" ? 1_200 : 2_500;
        const baseValidator = phase === "adjudicate" ? isStrictReviewEnvelope : isReviewEnvelope;
        const validateEnvelope = value => {
          if (!baseValidator(value)) return false;
          try {
            normalizeReviewItems(value, requestKeys, {
              unresolvedMissingCorrection: phase === "review"
            });
            return true;
          } catch {
            return false;
          }
        };
        const response = await cachedDeepInfraRequest(model, prompt, {
          validateEnvelope,
          maxTokens,
          timeoutMs: model.includes("Qwen/") ? 75_000 : REQUEST_TIMEOUT_MS,
          responseFormat: reviewResponseFormat(requestKeys)
        });
        console.log(`${locale.code}: ${phase} request ${requestNumber} complete`);
        return response;
      } catch (error) {
        throw new Error(`${locale.code}: ${phase} request ${requestNumber} with ${model} failed: ${error.message}`, { cause: error });
      }
    };
    let result;
    try {
      result = await reviewLocaleCatalog({
        locale,
        source,
        target: locale.ui,
        requiredKeys: REQUIRED_UI_KEYS,
        request: requestWithProgress,
        concurrency: 2
      });
    } catch (error) {
      delete overrides[locale.code];
      records[locale.code] = {
        status: "failed",
        method: "deepinfra-dual-model",
        reviewers: [...TRANSLATION_REVIEW_MODELS.reviewers],
        adjudicator: TRANSLATION_REVIEW_MODELS.adjudicator,
        reviewedAt: new Date().toISOString(),
        catalogHash: null,
        corrections: 0,
        reason: error?.message || String(error)
      };
      console.error(`${locale.code}: review failed; locale remains hidden (${error?.message || String(error)})`);
      await checkpointReviewArtifacts();
      return;
    }
    if (result.status !== "approved") {
      delete overrides[locale.code];
      records[locale.code] = {
        status: "failed",
        method: "deepinfra-dual-model",
        reviewers: [...TRANSLATION_REVIEW_MODELS.reviewers],
        adjudicator: TRANSLATION_REVIEW_MODELS.adjudicator,
        reviewedAt: new Date().toISOString(),
        catalogHash: null,
        corrections: result.corrections,
        reason: result.reason
      };
      console.error(`${locale.code}: ${result.reason}`);
      await checkpointReviewArtifacts();
      return;
    }
    const errors = staticCatalogErrors(locale, result.catalog);
    if (errors.length) {
      records[locale.code] = { status: "failed", method: "deterministic-validation", reviewedAt: new Date().toISOString(), catalogHash: null, corrections: result.corrections, reason: errors.join("; ") };
      delete overrides[locale.code];
      await checkpointReviewArtifacts();
      return;
    }
    // Store the complete approved catalog so a later review can replace or
    // revert earlier generated corrections without depending on source layout.
    overrides[locale.code] = Object.fromEntries(
      REQUIRED_UI_KEYS.map(key => [key, result.catalog[key]])
    );
    records[locale.code] = {
      status: "approved",
      method: "deepinfra-dual-model",
      reviewers: [...TRANSLATION_REVIEW_MODELS.reviewers],
      adjudicator: TRANSLATION_REVIEW_MODELS.adjudicator,
      reviewedAt: new Date().toISOString(),
      catalogHash: catalogHash(result.catalog, REQUIRED_UI_KEYS),
      corrections: result.corrections
    };
    await checkpointReviewArtifacts();
    console.log(`${locale.code}: review checkpoint saved`);
  });

  await artifactWrite;
  await writeReviewArtifacts(records, overrides);
  const approved = Object.entries(records).filter(([, record]) => record.status === "approved").map(([code]) => code);
  console.log(`Review artifacts updated. Approved records: ${approved.join(", ")}.`);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

export const TRANSLATION_REVIEW_MODELS = Object.freeze({
  reviewers: ["google/gemma-4-26B-A4B-it", "Qwen/Qwen3.6-35B-A3B"],
  adjudicator: "google/gemma-4-31B-it"
});

const VERDICTS = new Set(["pass", "fix", "block"]);
const PLACEHOLDER_PATTERN = /(\{\{[^{}]+\}\}|\$\{[^{}]+\}|%\d*\$?[a-z]|<\/?[a-z][^>]*>)/giu;

export function placeholders(value) {
  return String(value || "").match(PLACEHOLDER_PATTERN) || [];
}

export function validateCatalog(source, target, requiredKeys) {
  const errors = [];
  for (const key of requiredKeys) {
    if (typeof target?.[key] !== "string" || !target[key].trim()) errors.push(`${key}: missing`);
    if (JSON.stringify(placeholders(source?.[key])) !== JSON.stringify(placeholders(target?.[key]))) {
      errors.push(`${key}: placeholders changed`);
    }
  }
  for (const key of Object.keys(target || {})) {
    if (!requiredKeys.includes(key)) errors.push(`${key}: unexpected key`);
  }
  return errors;
}

export function chunkEntries(source, target, keys, size = 18) {
  const chunks = [];
  for (let index = 0; index < keys.length; index += size) {
    chunks.push(keys.slice(index, index + size).map(key => ({
      key,
      source: source[key],
      translation: target[key]
    })));
  }
  return chunks;
}

export function parseReviewObject(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("Empty translation review response");
  try {
    const direct = JSON.parse(source);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  } catch {
    // Providers may still wrap JSON despite response-format instructions.
  }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const value = JSON.parse(source.slice(start, end + 1));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  throw new Error("Invalid translation review JSON");
}

export function normalizeReviewItems(payload, expectedKeys) {
  if (!payload || !Array.isArray(payload.items)) throw new Error("Translation review must contain items");
  if (payload.items.length !== expectedKeys.length) throw new Error("Translation review item count mismatch");
  const items = new Map();
  for (const item of payload.items) {
    if (!item || !expectedKeys.includes(item.key) || items.has(item.key) || !VERDICTS.has(item.verdict)) {
      throw new Error("Invalid translation review item");
    }
    const correction = typeof item.correction === "string" ? item.correction.trim() : "";
    if (item.verdict === "fix" && !correction) throw new Error("Translation correction is missing");
    items.set(item.key, {
      key: item.key,
      verdict: item.verdict,
      correction,
      issues: Array.isArray(item.issues) ? item.issues.filter(value => typeof value === "string").slice(0, 8) : []
    });
  }
  return items;
}

export function buildReviewerPrompt(locale, entries) {
  return `You are independently reviewing interface translations for Lumen, an informational medical-document explanation app.
Review from ${entries[0]?.source ? "English" : "the source language"} into ${locale.prompt}. Use the ${locale.script} writing system and ${locale.dir} direction.
Check natural grammar, preserved meaning, calm medical neutrality, accessibility labels, disclaimers, status terminology, punctuation, placeholders, and absence of unintended English. Product names, file types, medical abbreviations, numbers, and units may remain Latin.
Do not diagnose, add medical claims, weaken safety language, or discuss anything outside the supplied interface strings.
Return exactly one JSON object with this shape and one item for every supplied key:
{"items":[{"key":"exact key","verdict":"pass|fix|block","correction":"complete corrected translation or empty string","issues":["short reason"]}]}
Use "pass" when the current translation is release-ready. Use "fix" only with a complete replacement. Use "block" only when no safe correction can be produced.
Interface strings:
${JSON.stringify(entries)}`;
}

export function buildAdjudicatorPrompt(locale, entries) {
  return `You are the final translation adjudicator for Lumen, an informational medical-document explanation app.
Choose or produce the safest, most natural ${locale.prompt} translation for every supplied item. Preserve the English meaning, placeholders, medical neutrality, accessibility intent, and all disclaimers. Do not diagnose or add treatment advice.
Return exactly one JSON object:
{"items":[{"key":"exact key","verdict":"pass|fix|block","correction":"final complete translation or empty string","issues":["short reason"]}]}
Use "pass" only when the current translation should remain unchanged. Use "fix" with the final replacement. Use "block" only if none can be made safe.
Disputed items:
${JSON.stringify(entries)}`;
}

function adjudicationEntries(entries, first, second) {
  return entries.filter(entry => first.get(entry.key).verdict !== "pass" || second.get(entry.key).verdict !== "pass")
    .map(entry => ({
      ...entry,
      reviewerA: first.get(entry.key),
      reviewerB: second.get(entry.key)
    }));
}

export async function reviewLocaleCatalog({
  locale,
  source,
  target,
  requiredKeys,
  request,
  chunkSize = 18,
  maxRepairRounds = 2
}) {
  const initialErrors = validateCatalog(source, target, requiredKeys);
  if (initialErrors.length) return { status: "failed", reason: initialErrors.join("; "), catalog: target, corrections: 0 };

  const catalog = { ...target };
  let corrections = 0;
  for (let round = 0; round <= maxRepairRounds; round++) {
    let roundCorrections = 0;
    for (const entries of chunkEntries(source, catalog, requiredKeys, chunkSize)) {
      const prompt = buildReviewerPrompt(locale, entries);
      const [firstPayload, secondPayload] = await Promise.all(
        TRANSLATION_REVIEW_MODELS.reviewers.map(model => request(model, prompt))
      );
      const expectedKeys = entries.map(entry => entry.key);
      const first = normalizeReviewItems(firstPayload, expectedKeys);
      const second = normalizeReviewItems(secondPayload, expectedKeys);
      const disputed = adjudicationEntries(entries, first, second);
      if (!disputed.length) continue;

      const adjudicatedPayload = await request(
        TRANSLATION_REVIEW_MODELS.adjudicator,
        buildAdjudicatorPrompt(locale, disputed)
      );
      const adjudicated = normalizeReviewItems(adjudicatedPayload, disputed.map(item => item.key));
      for (const entry of disputed) {
        const verdict = adjudicated.get(entry.key);
        if (verdict.verdict === "block") {
          return { status: "failed", reason: `${entry.key}: adjudicator blocked release`, catalog, corrections };
        }
        if (verdict.verdict !== "fix") continue;
        if (round === maxRepairRounds) {
          return { status: "failed", reason: `${entry.key}: correction did not pass after ${maxRepairRounds} repair rounds`, catalog, corrections };
        }
        if (JSON.stringify(placeholders(source[entry.key])) !== JSON.stringify(placeholders(verdict.correction))) {
          return { status: "failed", reason: `${entry.key}: adjudicated correction changed placeholders`, catalog, corrections };
        }
        if (catalog[entry.key] !== verdict.correction) {
          catalog[entry.key] = verdict.correction;
          corrections++;
          roundCorrections++;
        }
      }
    }
    const errors = validateCatalog(source, catalog, requiredKeys);
    if (errors.length) return { status: "failed", reason: errors.join("; "), catalog, corrections };
    if (roundCorrections === 0) return { status: "approved", catalog, corrections };
  }
  return { status: "failed", reason: "Translation review did not converge", catalog, corrections };
}

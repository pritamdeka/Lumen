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

export function normalizeReviewItems(payload, expectedKeys, { unresolvedMissingCorrection = false } = {}) {
  if (!payload || !Array.isArray(payload.items)) throw new Error("Translation review must contain items");
  if (payload.items.length !== expectedKeys.length) throw new Error("Translation review item count mismatch");
  const items = new Map();
  for (const item of payload.items) {
    if (!item || !expectedKeys.includes(item.key) || items.has(item.key) || !VERDICTS.has(item.verdict)) {
      throw new Error("Invalid translation review item");
    }
    const correction = typeof item.correction === "string" ? item.correction.trim() : "";
    if (item.verdict === "fix" && !correction && !unresolvedMissingCorrection) {
      throw new Error("Translation correction is missing");
    }
    items.set(item.key, {
      key: item.key,
      verdict: item.verdict === "fix" && !correction ? "block" : item.verdict,
      correction,
      issues: [
        ...(Array.isArray(item.issues) ? item.issues.filter(value => typeof value === "string").slice(0, 8) : []),
        ...(item.verdict === "fix" && !correction ? ["Reviewer proposed a fix without a replacement"] : [])
      ].slice(0, 8)
    });
  }
  return items;
}

export function buildReviewerPrompt(locale, entries) {
  if (entries.length === 1) {
    return `Review one Lumen interface translation into ${locale.prompt} (${locale.script}, ${locale.dir}).
Require exact meaning, natural wording, medical neutrality, preserved placeholders, and unchanged safety strength. Return pass, fix with a complete replacement, or block.
Interface strings:
${JSON.stringify([{ key: "item", english: entries[0].source, current: entries[0].translation }])}`;
  }
  if (entries.length <= 3) {
    return `Review these English-to-${locale.prompt} Lumen interface translations in ${locale.script} script (${locale.dir}).
Require natural grammar, exact meaning, medical neutrality, preserved placeholders, accessible labels, and unchanged safety/disclaimer strength. Do not diagnose or add advice.
Return one JSON item per supplied key using verdict "pass", "fix", or "block". A "fix" requires the complete replacement in "correction"; otherwise use "block". Keep "issues" brief.
Interface strings:
${JSON.stringify(entries)}`;
  }
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
  const promptEntries = entries.length === 1
    ? entries.map(entry => ({
        key: "item",
        english: entry.source,
        current: entry.translation,
        reviewerA: { verdict: entry.reviewerA.verdict, candidate: entry.reviewerA.correction },
        reviewerB: { verdict: entry.reviewerB.verdict, candidate: entry.reviewerB.correction }
      }))
    : entries;
  return `You are the final translation adjudicator for Lumen, an informational medical-document explanation app.
Choose or produce the safest, most natural ${locale.prompt} translation for every supplied item. Preserve the English meaning, placeholders, medical neutrality, accessibility intent, and all disclaimers. Do not diagnose or add treatment advice.
Return exactly one JSON object:
{"items":[{"key":"exact key","verdict":"pass|fix|block","correction":"final complete translation or empty string","issues":["short reason"]}]}
Use "pass" only when the current translation should remain unchanged. Use "fix" with the final replacement. Use "block" only if none can be made safe.
Disputed items:
${JSON.stringify(promptEntries)}`;
}

function adjudicationEntries(entries, first, second) {
  return entries.filter(entry => first.get(entry.key).verdict !== "pass" || second.get(entry.key).verdict !== "pass")
    .map(entry => ({
      ...entry,
      reviewerA: first.get(entry.key),
      reviewerB: second.get(entry.key)
    }));
}

export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let failure;
  async function run() {
    while (!failure && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        failure ||= error;
      }
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => run());
  await Promise.all(workers);
  if (failure) throw failure;
  return results;
}

export async function reviewLocaleCatalog({
  locale,
  source,
  target,
  requiredKeys,
  request,
  chunkSize = 6,
  adjudicationChunkSize = 3,
  concurrency = 3,
  maxRepairRounds = 0
}) {
  const initialErrors = validateCatalog(source, target, requiredKeys);
  if (initialErrors.length) return { status: "failed", reason: initialErrors.join("; "), catalog: target, corrections: 0 };

  const catalog = { ...target };
  let corrections = 0;
  async function requestReviewer(model, entries) {
    try {
      const payload = await request(model, buildReviewerPrompt(locale, entries));
      const normalizedPayload = entries.length === 1 && payload?.items?.length === 1
        ? { ...payload, items: [{ ...payload.items[0], key: entries[0].key }] }
        : payload;
      normalizeReviewItems(normalizedPayload, entries.map(entry => entry.key), { unresolvedMissingCorrection: true });
      return normalizedPayload;
    } catch (error) {
      if (entries.length <= 1) throw error;
      const middle = Math.ceil(entries.length / 2);
      const left = await requestReviewer(model, entries.slice(0, middle));
      const right = await requestReviewer(model, entries.slice(middle));
      return { items: [...left.items, ...right.items] };
    }
  }
  async function requestAdjudicator(entries) {
    try {
      const payload = await request(
        TRANSLATION_REVIEW_MODELS.adjudicator,
        buildAdjudicatorPrompt(locale, entries)
      );
      const normalizedPayload = entries.length === 1 && payload?.items?.length === 1
        ? { ...payload, items: [{ ...payload.items[0], key: entries[0].key }] }
        : payload;
      normalizeReviewItems(normalizedPayload, entries.map(entry => entry.key));
      return normalizedPayload;
    } catch (error) {
      if (entries.length <= 1) throw error;
      const middle = Math.ceil(entries.length / 2);
      const left = await requestAdjudicator(entries.slice(0, middle));
      const right = await requestAdjudicator(entries.slice(middle));
      return { items: [...left.items, ...right.items] };
    }
  }
  for (let round = 0; round <= maxRepairRounds; round++) {
    let roundCorrections = 0;
    const chunks = chunkEntries(source, catalog, requiredKeys, chunkSize);
    const chunkResults = await mapWithConcurrency(chunks, concurrency, async entries => {
      const [firstPayload, secondPayload] = await Promise.all(
        TRANSLATION_REVIEW_MODELS.reviewers.map(model => requestReviewer(model, entries))
      );
      const expectedKeys = entries.map(entry => entry.key);
      const first = normalizeReviewItems(firstPayload, expectedKeys, { unresolvedMissingCorrection: true });
      const second = normalizeReviewItems(secondPayload, expectedKeys, { unresolvedMissingCorrection: true });
      const disputed = adjudicationEntries(entries, first, second);
      if (!disputed.length) return { updates: [] };

      const updates = [];
      for (let disputedIndex = 0; disputedIndex < disputed.length; disputedIndex += adjudicationChunkSize) {
        const disputedEntries = disputed.slice(disputedIndex, disputedIndex + adjudicationChunkSize);
        const adjudicatedPayload = await requestAdjudicator(disputedEntries);
        const adjudicated = normalizeReviewItems(adjudicatedPayload, disputedEntries.map(item => item.key));
        for (const entry of disputedEntries) {
          const verdict = adjudicated.get(entry.key);
          if (verdict.verdict === "block") {
            return { reason: `${entry.key}: adjudicator blocked release` };
          }
          if (verdict.verdict !== "fix") continue;
          if (JSON.stringify(placeholders(source[entry.key])) !== JSON.stringify(placeholders(verdict.correction))) {
            return { reason: `${entry.key}: adjudicated correction changed placeholders` };
          }
          if (catalog[entry.key] !== verdict.correction) {
            updates.push([entry.key, verdict.correction]);
          }
        }
      }
      return { updates };
    });
    const failed = chunkResults.find(result => result.reason);
    if (failed) return { status: "failed", reason: failed.reason, catalog, corrections };
    for (const result of chunkResults) {
      for (const [key, correction] of result.updates) {
        if (catalog[key] === correction) continue;
        catalog[key] = correction;
        corrections++;
        roundCorrections++;
      }
    }
    const errors = validateCatalog(source, catalog, requiredKeys);
    if (errors.length) return { status: "failed", reason: errors.join("; "), catalog, corrections };
    if (roundCorrections === 0 || round === maxRepairRounds) return { status: "approved", catalog, corrections };
  }
  return { status: "failed", reason: "Translation review did not converge", catalog, corrections };
}

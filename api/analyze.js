import { getLocale, hasExpectedScript, localeFromLegacyPrompt, LOCALES } from "../src/locales.js";

export const config = { maxDuration: 60 };
export const MAX_PAGES = 5;
export const MAX_IMAGE_DATA_CHARS = 4_000_000;

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HITS = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

function rateLimited(ip) {
  const now = Date.now();
  const record = HITS.get(ip) || { count: 0, start: now };
  if (now - record.start > WINDOW_MS) {
    record.count = 0;
    record.start = now;
  }
  record.count++;
  HITS.set(ip, record);
  return record.count > MAX_PER_WINDOW;
}

export function buildPrompt(localeCode) {
  const locale = getLocale(localeCode);
  return `You are a careful medical communicator. Read every supplied page of this medical document in page order.

Your job is to TRANSLATE, not diagnose. Explain in ${locale.prompt}, using the ${locale.script} writing system, for a person with no medical background. Be warm, calm, and precise. Never invent values that are not visible. If the images are not a medical document, say so politely in the requested language and leave arrays empty.

Safety rules:
- Do not diagnose conditions. Say what a value MAY relate to and that a doctor must interpret it.
- Never suggest medication changes.
- If any value looks critically abnormal, set overall to "urgent" and advise prompt medical contact.
- Preserve numbers, units, medicine names, and reference ranges exactly as visible.

Respond with ONLY valid JSON, no markdown fences:
{
 "outputLocale": "${locale.code}",
 "isMedical": true,
 "overall": "ok" | "attention" | "urgent",
 "headline": "one warm sentence in the requested language (max 18 words)",
 "subline": "one sentence in the requested language (max 20 words)",
 "reportType": "document type in the requested language",
 "findings": [{"test":"name","meaningShort":"plain meaning","value":"number","unit":"unit","refRange":"range if shown","status":"normal|low|high|borderline|critical","explain":"one plain sentence for non-normal values, otherwise empty"}],
 "meaning": ["2-4 short paragraphs in the requested language"],
 "questions": ["4-6 questions in the requested language referencing actual values"],
 "lifestyle": ["2-4 gentle general wellbeing suggestions; never medication advice"],
 "urgencyTitle": "short follow-up heading in the requested language",
 "urgencyNote": "1-2 non-alarmist follow-up sentences in the requested language"
}`;
}

export function normalizeRequest(body) {
  const value = body && typeof body === "object" ? body : {};
  let localeCode = value.locale;
  if (localeCode === undefined && value.language !== undefined) {
    localeCode = localeFromLegacyPrompt(value.language);
  }
  if (localeCode === undefined) localeCode = "en";
  if (typeof localeCode !== "string" || !LOCALES.some(locale => locale.code === localeCode)) {
    const error = new Error("Unsupported locale");
    error.code = "unsupported_locale";
    throw error;
  }

  let images = value.images;
  if (images === undefined && typeof value.image === "string") {
    images = [{ data: value.image, mime: value.mime || "image/jpeg" }];
  }
  if (!Array.isArray(images) || images.length === 0) {
    const error = new Error("Missing image data");
    error.code = "missing_images";
    throw error;
  }
  if (images.length > MAX_PAGES) {
    const error = new Error("Too many pages");
    error.code = "too_many_pages";
    throw error;
  }

  const normalized = images.map(image => {
    if (!image || typeof image.data !== "string" || !image.data || !ALLOWED_MIME_TYPES.has(image.mime || "image/jpeg")) {
      const error = new Error("Invalid image data");
      error.code = "invalid_image";
      throw error;
    }
    return { data: image.data, mime: image.mime || "image/jpeg" };
  });
  if (normalized.reduce((sum, image) => sum + image.data.length, 0) > MAX_IMAGE_DATA_CHARS) {
    const error = new Error("Image payload too large");
    error.code = "payload_too_large";
    throw error;
  }
  return { localeCode, images: normalized };
}

async function callGemini(key, prompt, images) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, ...images.map(image => ({ inline_data: { mime_type: image.mime, data: image.data } }))] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
      })
    }
  );
  if (!response.ok) throw new Error("Gemini " + response.status);
  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini empty");
  return text;
}

async function callOpenAICompat(name, url, key, model, prompt, images) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map(image => ({ type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } }))
        ]
      }],
      temperature: 0.4
    })
  });
  if (!response.ok) throw new Error(`${name} ${response.status}`);
  const json = await response.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${name} empty`);
  return text;
}

export function parseReport(text, localeCode = "en") {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in model output");
  const report = JSON.parse(match[0]);
  if (typeof report.headline !== "string" || !["ok", "attention", "urgent"].includes(report.overall)) {
    throw new Error("Invalid report shape");
  }
  if (report.outputLocale !== localeCode) throw new Error("Wrong output locale");
  report.findings = Array.isArray(report.findings) ? report.findings : [];
  report.meaning = Array.isArray(report.meaning) ? report.meaning : [];
  report.questions = Array.isArray(report.questions) ? report.questions : [];
  report.lifestyle = Array.isArray(report.lifestyle) ? report.lifestyle : [];
  const narrative = [report.headline, report.subline, report.reportType, ...report.meaning, ...report.questions, report.urgencyTitle, report.urgencyNote].join(" ");
  if (!hasExpectedScript(narrative, localeCode)) throw new Error("Wrong output script");
  return report;
}

function sendError(res, status, code, message) {
  res.status(status).json({ code, error: message });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendError(res, 405, "method_not_allowed", "Method not allowed");
    return;
  }
  const ip = String(req.headers?.["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    sendError(res, 429, "rate_limited", "Too many requests. Please wait a minute.");
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  let input;
  try {
    input = normalizeRequest(body);
  } catch (error) {
    const status = error.code === "payload_too_large" ? 413 : 400;
    sendError(res, status, error.code || "invalid_request", error.message);
    return;
  }

  const prompt = buildPrompt(input.localeCode);
  const providers = [
    { name: "Gemini", enabled: !!process.env.GEMINI_API_KEY, run: () => callGemini(process.env.GEMINI_API_KEY, prompt, input.images) },
    { name: "Groq", enabled: !!process.env.GROQ_API_KEY, run: () => callOpenAICompat("Groq", "https://api.groq.com/openai/v1/chat/completions", process.env.GROQ_API_KEY, "meta-llama/llama-4-scout-17b-16e-instruct", prompt, input.images) },
    { name: "DeepInfra", enabled: !!process.env.DEEPINFRA_API_KEY, run: () => callOpenAICompat("DeepInfra", "https://api.deepinfra.com/v1/openai/chat/completions", process.env.DEEPINFRA_API_KEY, "google/gemma-4-26B-A4B-it", prompt, input.images) },
    { name: "OpenRouter", enabled: !!process.env.OPENROUTER_API_KEY, run: () => callOpenAICompat("OpenRouter", "https://openrouter.ai/api/v1/chat/completions", process.env.OPENROUTER_API_KEY, "qwen/qwen2.5-vl-72b-instruct:free", prompt, input.images) }
  ].filter(provider => provider.enabled);

  if (providers.length === 0) {
    sendError(res, 500, "no_provider", "No AI provider configured");
    return;
  }

  let lastError = null;
  for (const provider of providers) {
    try {
      const raw = await provider.run();
      const report = parseReport(raw, input.localeCode);
      res.status(200).json({ report, provider: provider.name });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  sendError(res, 502, "providers_failed", "All AI providers failed: " + String(lastError?.message || lastError));
}

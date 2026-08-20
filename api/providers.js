export const MAX_PROVIDER_OUTPUT_TOKENS = 16_384;
export const PROVIDER_TIMEOUT_MS = 50_000;

export const PROVIDER_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "Gemini",
    envKey: "GEMINI_API_KEY",
    kind: "gemini",
    model: "gemini-2.5-flash",
    // Gemini is by far the fastest OCR route measured against real report pages,
    // so it also serves the extraction stage when its key is configured.
    extractionModel: "gemini-2.5-flash",
    timeoutMs: 40_000,
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
  }),
  Object.freeze({
    name: "Groq",
    envKey: "GROQ_API_KEY",
    kind: "openai",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "qwen/qwen3.6-27b",
    timeoutMs: 20_000,
    // Groq rejects the whole request when prompt plus max_tokens exceeds the
    // account tokens-per-minute allowance, so cap what we ever ask it for.
    outputTokenCap: 2_400,
    // The free tier's per-minute token allowance rejects a burst of parallel batches.
    maxParallelCalls: 1,
    extraBody: Object.freeze({ reasoning_effort: "none" })
  }),
  Object.freeze({
    name: "DeepInfra",
    envKey: "DEEPINFRA_API_KEY",
    kind: "openai",
    endpoint: "https://api.deepinfra.com/v1/openai/chat/completions",
    model: "Qwen/Qwen3.5-35B-A3B",
    extractionModel: "Qwen/Qwen3-VL-30B-A3B-Instruct",
    explanationModel: "Qwen/Qwen3.5-27B",
    timeoutMs: 50_000,
    imageFirst: true,
    sampling: Object.freeze({ temperature: 0.2, top_p: 0.95, top_k: 64 }),
    extraBody: Object.freeze({ reasoning_effort: "none" })
  })
]);

function providerError(name, detail) {
  return new Error(`${name} ${detail}`);
}

async function readProviderJson(response, name) {
  try {
    return await response.json();
  } catch {
    throw providerError(name, "returned invalid JSON");
  }
}

function errorMessage(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.message === "string") return value.message;
  return "provider error";
}

export function extractGeminiText(json) {
  if (json?.error) throw providerError("Gemini", errorMessage(json.error));
  const candidate = json?.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") throw providerError("Gemini", "output was truncated");
  const text = candidate?.content?.parts
    ?.map(part => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("");
  if (!text?.trim()) throw providerError("Gemini", "returned an empty response");
  return text;
}

export function extractOpenAIText(json, name = "Provider") {
  if (json?.error) throw providerError(name, errorMessage(json.error));
  const choice = json?.choices?.[0];
  if (["length", "max_tokens"].includes(choice?.finish_reason)) {
    throw providerError(name, "output was truncated");
  }
  if (choice?.message?.refusal) throw providerError(name, "refused the request");
  const content = choice?.message?.content;
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map(part => typeof part?.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("");
  } else if (typeof choice?.text === "string") {
    text = choice.text;
  }
  if (!text.trim()) throw providerError(name, "returned an empty response");
  return text;
}

export function buildOpenAIRequest(provider, prompt, images, maxOutputTokens = MAX_PROVIDER_OUTPUT_TOKENS) {
  const imageParts = images.map(image => ({
    type: "image_url",
    image_url: { url: `data:${image.mime};base64,${image.data}` }
  }));
  const content = images.length === 0
    ? prompt
    : provider.imageFirst
      ? [...imageParts, { type: "text", text: prompt }]
      : [{ type: "text", text: prompt }, ...imageParts];
  return {
    model: provider.model,
    messages: [{ role: "user", content }],
    temperature: provider.sampling?.temperature ?? 0.2,
    max_tokens: maxOutputTokens,
    ...(provider.jsonMode === false ? {} : { response_format: { type: "json_object" } }),
    stream: false,
    ...(provider.sampling?.top_p === undefined ? {} : { top_p: provider.sampling.top_p }),
    ...(provider.sampling?.top_k === undefined ? {} : { top_k: provider.sampling.top_k }),
    ...(provider.extraBody || {})
  };
}

export function getConfiguredProviders(environment = process.env) {
  return PROVIDER_DEFINITIONS
    .filter(provider => typeof environment[provider.envKey] === "string" && environment[provider.envKey].trim())
    .map(provider => ({ ...provider, key: environment[provider.envKey].trim() }));
}

export function getProviderStatus(environment = process.env) {
  return PROVIDER_DEFINITIONS.map(provider => ({
    name: provider.name,
    model: provider.model,
    ...(provider.extractionModel ? { extractionModel: provider.extractionModel } : {}),
    ...(provider.explanationModel ? { explanationModel: provider.explanationModel } : {}),
    timeoutMs: provider.timeoutMs,
    configured: typeof environment[provider.envKey] === "string" && Boolean(environment[provider.envKey].trim())
  }));
}

export async function callProvider(provider, prompt, images, fetchImplementation = globalThis.fetch, options = {}) {
  if (typeof fetchImplementation !== "function") throw providerError(provider.name, "transport is unavailable");
  const outputCap = Number.isInteger(provider.outputTokenCap) && provider.outputTokenCap > 0
    ? Math.min(MAX_PROVIDER_OUTPUT_TOKENS, provider.outputTokenCap)
    : MAX_PROVIDER_OUTPUT_TOKENS;
  const maxOutputTokens = Number.isInteger(options.maxOutputTokens)
    ? Math.min(outputCap, Math.max(1, options.maxOutputTokens))
    : outputCap;
  if (provider.kind === "gemini") {
    const response = await fetchImplementation(`${provider.endpoint}?key=${encodeURIComponent(provider.key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            ...images.map(image => ({ inline_data: { mime_type: image.mime, data: image.data } }))
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens,
          ...(provider.jsonMode === false ? {} : { responseMimeType: "application/json" }),
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    });
    if (!response.ok) throw providerError(provider.name, `HTTP ${response.status}`);
    return extractGeminiText(await readProviderJson(response, provider.name));
  }

  const response = await fetchImplementation(provider.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${provider.key}`
    },
    signal: options.signal,
    body: JSON.stringify(buildOpenAIRequest(provider, prompt, images, maxOutputTokens))
  });
  if (!response.ok) throw providerError(provider.name, `HTTP ${response.status}`);
  return extractOpenAIText(await readProviderJson(response, provider.name), provider.name);
}

export async function callProviderWithTimeout(provider, prompt, images, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : PROVIDER_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await callProvider(
      provider,
      prompt,
      images,
      options.fetchImplementation || globalThis.fetch,
      { signal: controller.signal, maxOutputTokens: options.maxOutputTokens }
    );
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = providerError(provider.name, "timed out");
      timeoutError.code = "provider_timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

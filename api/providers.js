export const MAX_PROVIDER_OUTPUT_TOKENS = 16_384;
export const PROVIDER_TIMEOUT_MS = 180_000;

export const PROVIDER_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "Gemini",
    envKey: "GEMINI_API_KEY",
    kind: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
  }),
  Object.freeze({
    name: "Groq",
    envKey: "GROQ_API_KEY",
    kind: "openai",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "qwen/qwen3.6-27b",
    extraBody: Object.freeze({ reasoning_effort: "none" })
  }),
  Object.freeze({
    name: "DeepInfra",
    envKey: "DEEPINFRA_API_KEY",
    kind: "openai",
    endpoint: "https://api.deepinfra.com/v1/openai/chat/completions",
    model: "google/gemma-4-26B-A4B-it"
  }),
  Object.freeze({
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    kind: "openai",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "qwen/qwen2.5-vl-72b-instruct"
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
  const content = images.length === 0
    ? prompt
    : [
        { type: "text", text: prompt },
        ...images.map(image => ({
          type: "image_url",
          image_url: { url: `data:${image.mime};base64,${image.data}` }
        }))
      ];
  return {
    model: provider.model,
    messages: [{ role: "user", content }],
    temperature: 0.2,
    max_tokens: maxOutputTokens,
    response_format: { type: "json_object" },
    stream: false,
    ...(provider.extraBody || {})
  };
}

export function getConfiguredProviders(environment = process.env) {
  return PROVIDER_DEFINITIONS
    .filter(provider => typeof environment[provider.envKey] === "string" && environment[provider.envKey].trim())
    .map(provider => ({ ...provider, key: environment[provider.envKey].trim() }));
}

export async function callProvider(provider, prompt, images, fetchImplementation = globalThis.fetch, options = {}) {
  if (typeof fetchImplementation !== "function") throw providerError(provider.name, "transport is unavailable");
  const maxOutputTokens = Number.isInteger(options.maxOutputTokens)
    ? Math.min(MAX_PROVIDER_OUTPUT_TOKENS, Math.max(1, options.maxOutputTokens))
    : MAX_PROVIDER_OUTPUT_TOKENS;
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
          responseMimeType: "application/json"
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

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAIRequest,
  callProvider,
  callProviderWithTimeout,
  extractGeminiText,
  extractOpenAIText,
  getConfiguredProviders,
  getProviderStatus,
  MAX_PROVIDER_OUTPUT_TOKENS,
  PROVIDER_TIMEOUT_MS,
  PROVIDER_DEFINITIONS
} from "../api/providers.js";

const EXPECTED_MODELS = {
  Gemini: "gemini-2.5-flash",
  Groq: "qwen/qwen3.6-27b",
  DeepInfra: "google/gemma-4-26B-A4B-it"
};

function response(json, overrides = {}) {
  return { ok: true, status: 200, json: async () => json, ...overrides };
}

test("provider registry has one current, credential-free definition per provider", () => {
  assert.deepEqual(PROVIDER_DEFINITIONS.map(item => item.name), ["Gemini", "Groq", "DeepInfra"]);
  for (const provider of PROVIDER_DEFINITIONS) {
    assert.equal(provider.model || null, EXPECTED_MODELS[provider.name]);
    assert.match(provider.endpoint, /^https:\/\//);
    assert.equal("key" in provider, false);
  }
  assert.equal(PROVIDER_DEFINITIONS.some(item => /llama-4-scout|Qwen2\.5-VL-32B|:free/.test(item.model || "")), false);
});

test("configured providers preserve fallback order and ignore blank keys", () => {
  const configured = getConfiguredProviders({
    GEMINI_API_KEY: " gemini-secret ",
    GROQ_API_KEY: "",
    DEEPINFRA_API_KEY: "deepinfra-secret"
  });
  assert.deepEqual(configured.map(item => item.name), ["Gemini", "DeepInfra"]);
  assert.deepEqual(configured.map(item => item.key), ["gemini-secret", "deepinfra-secret"]);
});

test("provider diagnostics expose model and configuration state without credentials", () => {
  const status = getProviderStatus({ GEMINI_API_KEY: "secret", GROQ_API_KEY: "  " });
  assert.deepEqual(status, [
    { name: "Gemini", model: "gemini-2.5-flash", timeoutMs: 15_000, configured: true },
    { name: "Groq", model: "qwen/qwen3.6-27b", timeoutMs: 12_000, configured: false },
    { name: "DeepInfra", model: "google/gemma-4-26B-A4B-it", extractionModel: "Qwen/Qwen3-VL-8B-Instruct", explanationModel: "Qwen/Qwen3.6-35B-A3B", timeoutMs: 50_000, configured: false }
  ]);
  assert.doesNotMatch(JSON.stringify(status), /secret|envKey|endpoint/);
});

test("OpenAI-compatible requests use JSON mode and provider-specific multimodal ordering", () => {
  for (const provider of PROVIDER_DEFINITIONS.filter(item => item.kind === "openai")) {
    const body = buildOpenAIRequest(provider, "prompt", [
      { data: "one", mime: "image/jpeg" },
      { data: "two", mime: "image/png" }
    ]);
    assert.equal(body.model, EXPECTED_MODELS[provider.name]);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.max_tokens, MAX_PROVIDER_OUTPUT_TOKENS);
    assert.equal(body.stream, false);
    assert.equal(body.messages[0].content.length, 3);
    if (provider.name === "DeepInfra") {
      assert.equal(body.messages[0].content[0].image_url.url, "data:image/jpeg;base64,one");
      assert.equal(body.messages[0].content[1].image_url.url, "data:image/png;base64,two");
      assert.equal(body.messages[0].content[2].text, "prompt");
      assert.equal(body.temperature, 0.2);
      assert.equal(body.top_p, 0.95);
      assert.equal(body.top_k, 64);
      assert.equal(body.reasoning_effort, "none");
    } else {
      assert.equal(body.messages[0].content[0].text, "prompt");
      assert.equal(body.messages[0].content[1].image_url.url, "data:image/jpeg;base64,one");
      assert.equal(body.messages[0].content[2].image_url.url, "data:image/png;base64,two");
      assert.equal(body.reasoning_effort, "none");
      assert.equal(body.temperature, 0.2);
    }
  }
});

test("text-only explanation requests use the broadly compatible string content shape", () => {
  for (const provider of PROVIDER_DEFINITIONS.filter(item => item.kind === "openai")) {
    const body = buildOpenAIRequest(provider, "explain this extraction", []);
    assert.equal(body.messages[0].content, "explain this extraction");
  }
});

test("provider requests can disable JSON mode for an OCR transcription pass", () => {
  const provider = { ...PROVIDER_DEFINITIONS.find(item => item.name === "DeepInfra"), jsonMode: false };
  const body = buildOpenAIRequest(provider, "transcribe", [{ data: "image", mime: "image/webp" }], 2_000);
  assert.equal(body.response_format, undefined);
  assert.equal(body.messages[0].content[0].type, "image_url");
});

test("provider requests accept stage-specific output limits", () => {
  for (const provider of PROVIDER_DEFINITIONS.filter(item => item.kind === "openai")) {
    assert.equal(buildOpenAIRequest(provider, "prompt", [], 4_000).max_tokens, 4_000);
  }
  assert.equal(PROVIDER_TIMEOUT_MS, 50_000);
});

test("Gemini parser combines text parts and detects empty, error, and truncated envelopes", () => {
  assert.equal(extractGeminiText({ candidates: [{ content: { parts: [{ text: "{\"a\":" }, { text: "1}" }] } }] }), '{"a":1}');
  assert.throws(() => extractGeminiText({ error: { message: "quota" } }), /quota/);
  assert.throws(() => extractGeminiText({ candidates: [{ finishReason: "MAX_TOKENS" }] }), /truncated/);
  assert.throws(() => extractGeminiText({ candidates: [] }), /empty/);
});

test("OpenAI-compatible parser supports string, content blocks, and legacy choice text", () => {
  assert.equal(extractOpenAIText({ choices: [{ message: { content: '{"a":1}' } }] }, "Test"), '{"a":1}');
  assert.equal(extractOpenAIText({ choices: [{ message: { content: [{ type: "text", text: '{"a":' }, { type: "text", text: "1}" }] } }] }, "Test"), '{"a":1}');
  assert.equal(extractOpenAIText({ choices: [{ text: '{"a":1}' }] }, "Test"), '{"a":1}');
  assert.throws(() => extractOpenAIText({ error: { message: "rate limited" } }, "Test"), /rate limited/);
  assert.throws(() => extractOpenAIText({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }, "Test"), /truncated/);
  assert.throws(() => extractOpenAIText({ choices: [{ message: { refusal: "no" } }] }, "Test"), /refused/);
  assert.throws(() => extractOpenAIText({ choices: [] }, "Test"), /empty/);
});

test("every provider adapter sends the expected authenticated request and returns JSON text", async () => {
  for (const definition of PROVIDER_DEFINITIONS) {
    const provider = { ...definition, key: `${definition.name}-secret` };
    let captured;
    const fetchMock = async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) };
      if (definition.kind === "gemini") {
        return response({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
      }
      return response({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] });
    };
    assert.equal(await callProvider(provider, "prompt", [{ data: "page", mime: "image/webp" }], fetchMock), '{"ok":true}');
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers.Accept, "application/json");
    if (definition.kind === "gemini") {
      assert.match(captured.url, /key=Gemini-secret$/);
      assert.equal(captured.body.contents[0].parts[1].inline_data.data, "page");
      assert.equal(captured.body.generationConfig.responseMimeType, "application/json");
      assert.deepEqual(captured.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    } else {
      assert.equal(captured.options.headers.Authorization, `Bearer ${definition.name}-secret`);
      const image = captured.body.messages[0].content.find(part => part.type === "image_url");
      assert.equal(image.image_url.url, "data:image/webp;base64,page");
    }
  }
});

test("every provider adapter rejects HTTP, malformed transport, and provider-level failures", async () => {
  for (const definition of PROVIDER_DEFINITIONS) {
    const provider = { ...definition, key: "secret" };
    await assert.rejects(callProvider(provider, "prompt", [], async () => response({}, { ok: false, status: 429 })), /HTTP 429/);
    await assert.rejects(callProvider(provider, "prompt", [], async () => response(null, { json: async () => { throw new SyntaxError("html"); } })), /invalid JSON/);
    await assert.rejects(callProvider(provider, "prompt", [], async () => response({ error: { message: "upstream unavailable" } })), /upstream unavailable/);
  }
});

test("provider timeout aborts the upstream request and returns a stable error code", async () => {
  const provider = { ...PROVIDER_DEFINITIONS[0], key: "secret" };
  let observedSignal;
  const fetchImplementation = async (url, options) => {
    observedSignal = options.signal;
    return await new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  };
  await assert.rejects(
    callProviderWithTimeout(provider, "prompt", [], { timeoutMs: 10, fetchImplementation }),
    error => error.code === "provider_timeout" && /Gemini timed out/.test(error.message)
  );
  assert.equal(observedSignal.aborted, true);
});

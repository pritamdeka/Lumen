import test from "node:test";
import assert from "node:assert/strict";
import speechHandler, { buildSsml, normalizeSpeechRequest } from "../api/speech.js";
import { AZURE_VOICES, bestDeviceVoice, buildNarrationSections, splitNarrationSections } from "../src/speech.js";

function mockResponse() {
  return { statusCode: 0, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, setHeader(key, value) { this.headers[key] = value; }, send(value) { this.body = value; return this; } };
}

test("maps every current and planned locale to an explicit Azure voice", () => {
  assert.deepEqual(Object.keys(AZURE_VOICES), ["en","hi","bn","as","ta","te","mr","kn","gu","ml","pa","or","ur","es","fr","de","it","pt-PT"]);
  for (const entry of Object.values(AZURE_VOICES)) assert.match(entry.voice, /Neural$/);
});

test("complete narration includes each reported value once and splits by section", () => {
  const report = { headline: "Summary", meaning: ["Meaning"], findings: [
    { test: "Alpha", value: "VALUE-ONE", unit: "mg/dL", refRange: "1-2", status: "normal" },
    { test: "Beta", value: "VALUE-TWO", status: "uninterpreted" }
  ], questions: ["What next?"] };
  const sections = buildNarrationSections(report, { reference: "range", uninterpreted: "not interpreted", disclaimer: "Not medical advice." });
  const text = sections.map(section => section.text).join(" ");
  assert.equal(text.match(/VALUE-ONE/g)?.length, 1);
  assert.equal(text.match(/VALUE-TWO/g)?.length, 1);
  assert.deepEqual(sections.map(section => section.key), ["overview", "findings", "questions", "disclaimer"]);
  assert.ok(splitNarrationSections(sections, 100).every(chunk => chunk.text.length <= 100));
});

test("device voice selection prefers exact locale then language family", () => {
  const voices = [{ lang: "en-US" }, { lang: "hi-IN" }];
  assert.equal(bestDeviceVoice(voices, "hi"), voices[1]);
  assert.equal(bestDeviceVoice(voices, "en"), voices[0]);
  assert.equal(bestDeviceVoice(voices, "or"), null);
});

test("speech request validation and SSML escaping are bounded", () => {
  const input = normalizeSpeechRequest({ locale: "ur", text: "A < B & C" });
  assert.equal(input.lang, "ur-IN");
  assert.match(buildSsml(input), /A &lt; B &amp; C/);
  assert.throws(() => normalizeSpeechRequest({ locale: "xx", text: "hello" }), /Unsupported locale/);
  assert.throws(() => normalizeSpeechRequest({ locale: "es", text: "hola" }), /Unsupported locale/);
  assert.throws(() => normalizeSpeechRequest({ locale: "en", text: "" }), /Missing narration text/);
  assert.throws(() => normalizeSpeechRequest({ locale: "en", text: "x".repeat(3001) }), /too long/);
});

test("speech API streams provider audio without caching", async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.AZURE_SPEECH_KEY;
  const oldRegion = process.env.AZURE_SPEECH_REGION;
  process.env.AZURE_SPEECH_KEY = "test-key";
  process.env.AZURE_SPEECH_REGION = "uksouth";
  let request;
  global.fetch = async (url, options) => { request = { url: String(url), options }; return { ok: true, arrayBuffer: async () => Uint8Array.from([1,2,3]).buffer }; };
  try {
    const response = mockResponse();
    await speechHandler({ method: "POST", headers: { "x-forwarded-for": "speech-success" }, body: { locale: "as", text: "স্বাস্থ্য" } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "audio/mpeg");
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.match(request.url, /uksouth\.tts\.speech\.microsoft\.com/);
    assert.doesNotMatch(request.options.body, /test-key/);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.AZURE_SPEECH_KEY; else process.env.AZURE_SPEECH_KEY = oldKey;
    if (oldRegion === undefined) delete process.env.AZURE_SPEECH_REGION; else process.env.AZURE_SPEECH_REGION = oldRegion;
  }
});

test("speech API rejects methods, malformed bodies, and missing configuration", async () => {
  const method = mockResponse(); await speechHandler({ method: "GET", headers: {} }, method); assert.equal(method.statusCode, 405);
  const malformed = mockResponse(); await speechHandler({ method: "POST", headers: { "x-forwarded-for": "speech-malformed" }, body: "{" }, malformed); assert.equal(malformed.body.code, "unsupported_locale");
  const oldKey = process.env.AZURE_SPEECH_KEY; delete process.env.AZURE_SPEECH_KEY;
  try { const missing = mockResponse(); await speechHandler({ method: "POST", headers: { "x-forwarded-for": "speech-missing-config" }, body: { locale: "en", text: "hello" } }, missing); assert.equal(missing.body.code, "speech_not_configured"); }
  finally { if (oldKey !== undefined) process.env.AZURE_SPEECH_KEY = oldKey; }
});

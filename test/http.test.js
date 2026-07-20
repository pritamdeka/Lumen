import test from "node:test";
import assert from "node:assert/strict";
import { ApiResponseError, parseJsonResponse, postAnalysis, validateAnalysisResponse } from "../src/http.js";

function response(body, { ok = true, status = 200, textError = null } = {}) {
  return { ok, status, async text() { if (textError) throw textError; return body; } };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof ApiResponseError);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /Unexpected token|is not valid JSON|<!doctype|An error occurred/i);
    return true;
  });
}

test("parses successful JSON with whitespace or a byte-order mark", async () => {
  assert.deepEqual(await parseJsonResponse(response('  {"ok":true}\n')), { ok: true });
  assert.deepEqual(await parseJsonResponse(response('\uFEFF{"ok":true}')), { ok: true });
});

test("rejects every non-JSON success-body class with a stable code", async () => {
  const invalidBodies = ["", "   ", "An error occurred", "<html><body>Error</body></html>", "{", "null", "[]", '"text"', "true", "42"];
  for (const body of invalidBodies) await expectCode(parseJsonResponse(response(body)), "invalid_response");
  await expectCode(parseJsonResponse(response("", { textError: new Error("stream failed") })), "invalid_response");
});

test("rejects every truncation and common proxy prefix without leaking parser details", async () => {
  const valid = '{"extraction":{"findings":[]},"provider":"Fixture"}';
  for (let index = 0; index < valid.length; index++) {
    await expectCode(parseJsonResponse(response(valid.slice(0, index))), "invalid_response");
  }
  for (const prefix of ["A", "An error occurred: ", "Error: ", "502 Bad Gateway\n", "```json\n", "<!-- proxy -->"]) {
    await expectCode(parseJsonResponse(response(prefix + valid)), "invalid_response");
  }
});

test("rejects plain-text, HTML, empty, and malformed server errors without parsing leaks", async () => {
  const errorBodies = ["", "An error occurred", "<!doctype html><h1>502</h1>", "{", "null", "[]"];
  for (const body of errorBodies) await expectCode(parseJsonResponse(response(body, { ok: false, status: 502 })), "server_error");
  await expectCode(parseJsonResponse(response("", { ok: false, status: 503, textError: new Error("closed") })), "server_error");
});

test("preserves validated API error codes but rejects unsafe codes", async () => {
  await expectCode(parseJsonResponse(response('{"code":"payload_too_large","error":"Too large"}', { ok: false, status: 413 })), "payload_too_large");
  await expectCode(parseJsonResponse(response('{"code":"BAD CODE!","error":"bad"}', { ok: false, status: 500 })), "server_error");
  await expectCode(parseJsonResponse(response('{"error":42}', { ok: false, status: 500 })), "server_error");
});

test("validates extraction and explanation response schemas", () => {
  const extraction = { extraction: { findings: [] }, provider: "Fixture" };
  const explanation = { report: { findings: [], meaning: [], questions: [] }, provider: "Fixture" };
  assert.equal(validateAnalysisResponse(extraction, "extract"), extraction);
  assert.equal(validateAnalysisResponse(explanation, "explain"), explanation);
  for (const invalid of [{}, { extraction: null }, { extraction: { findings: {} } }]) {
    assert.throws(() => validateAnalysisResponse(invalid, "extract"), error => error.code === "invalid_response");
  }
  for (const invalid of [{}, { report: null }, { report: { findings: [], meaning: [] } }, { report: { findings: {}, meaning: [], questions: [] } }]) {
    assert.throws(() => validateAnalysisResponse(invalid, "explain"), error => error.code === "invalid_response");
  }
});

test("postAnalysis handles network failure, request shape, success, and malformed success", async () => {
  await expectCode(postAnalysis(async () => { throw new Error("offline"); }, "/api/analyze", { stage: "extract" }), "network_error");
  let request;
  const data = await postAnalysis(async (url, options) => {
    request = { url, options };
    return response('{"extraction":{"findings":[]},"provider":"Fixture"}');
  }, "/api/analyze", { stage: "extract", locale: "en" });
  assert.equal(data.provider, "Fixture");
  assert.equal(request.url, "/api/analyze");
  assert.equal(request.options.headers.Accept, "application/json");
  assert.deepEqual(JSON.parse(request.options.body), { stage: "extract", locale: "en" });
  await expectCode(postAnalysis(async () => response('{"unexpected":true}'), "/api/analyze", { stage: "explain" }), "invalid_response");
});

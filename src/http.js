export class ApiResponseError extends Error {
  constructor(code, message = "Request failed") {
    super(message);
    this.name = "ApiResponseError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanErrorCode(value, fallback) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : fallback;
}

export async function parseJsonResponse(response) {
  const fallbackCode = response?.ok ? "invalid_response" : "server_error";
  let raw;
  try {
    raw = await response.text();
  } catch {
    throw new ApiResponseError(fallbackCode);
  }
  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new ApiResponseError(fallbackCode);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiResponseError(fallbackCode);
  }
  if (!isRecord(data)) throw new ApiResponseError(fallbackCode);
  if (!response.ok) {
    const code = cleanErrorCode(data.code, "server_error");
    const message = typeof data.error === "string" ? data.error.slice(0, 300) : "Request failed";
    throw new ApiResponseError(code, message);
  }
  return data;
}

export function validateAnalysisResponse(data, stage) {
  if (!isRecord(data)) throw new ApiResponseError("invalid_response");
  if (stage === "extract") {
    if (!isRecord(data.extraction) || !Array.isArray(data.extraction.findings)) throw new ApiResponseError("invalid_response");
  } else if (!isRecord(data.report) || !Array.isArray(data.report.findings) || !Array.isArray(data.report.meaning) || !Array.isArray(data.report.questions)) {
    throw new ApiResponseError("invalid_response");
  }
  return data;
}

export async function postAnalysis(fetchImplementation, url, payload) {
  let response;
  try {
    response = await fetchImplementation(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new ApiResponseError("network_error");
  }
  const data = await parseJsonResponse(response);
  return validateAnalysisResponse(data, payload?.stage);
}

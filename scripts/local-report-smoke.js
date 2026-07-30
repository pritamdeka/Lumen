import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const filename = process.argv[2];
const baseUrl = String(process.env.LUMEN_LOCAL_URL || "http://localhost:3000").replace(/\/+$/, "");
const MIME_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

if (!filename) {
  console.error("Usage: npm run test:report:local -- <report-image>");
  process.exit(1);
}

const mime = MIME_TYPES.get(extname(filename).toLowerCase());
if (!mime) {
  console.error("The report must be a JPG, PNG, or WebP image.");
  process.exit(1);
}

async function request(stage, payload) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ stage, locale: "en", ...payload })
    });
  } catch {
    console.error(JSON.stringify({ stage, status: 0, seconds: (Date.now() - startedAt) / 1000, code: "network_error" }));
    process.exit(2);
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  const summary = {
    stage,
    status: response.status,
    seconds: (Date.now() - startedAt) / 1000,
    code: response.ok ? "ok" : body.code || "invalid_response",
    provider: response.ok ? body.provider || "" : "",
    findings: stage === "extract"
      ? body.extraction?.findings?.length ?? 0
      : body.report?.totalFindings ?? 0,
    ...(stage === "explain" ? {
      explained: body.report?.explainedFindings ?? 0,
      neutralFallback: body.report?.explanationTimedOut === true
    } : {})
  };
  console.log(JSON.stringify(summary));
  if (!response.ok) process.exit(stage === "extract" ? 3 : 4);
  return body;
}

const bytes = await readFile(filename);
const extraction = await request("extract", {
  images: [{ data: bytes.toString("base64"), mime }]
});
await request("explain", { extraction: extraction.extraction });

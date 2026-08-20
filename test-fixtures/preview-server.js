import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { SCRIPT_FIXTURES } from "./scripts.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 8765);
const extraction = {
  isMedical: true,
  reportType: "Detailed candidate report",
  findings: [
    { test: "Blood pressure", value: "110/70", unit: "mmHg", refRange: "", confidence: "high", sourceText: "Blood pressure 110/70" },
    { test: "R.B.S", value: "96.0", unit: "mg/dL", refRange: "70–140", numericValue: 96, referenceLow: 70, referenceHigh: 140, referenceKind: "interval", comparisonName: "Random blood sugar", comparisonUnit: "mg/dL", confidence: "medium", sourceText: "R.B.S 96.0" },
    { test: "Creatinine", value: "0.3", unit: "mg/dL", refRange: "0.5–1.2", numericValue: 0.3, referenceLow: 0.5, referenceHigh: 1.2, referenceKind: "interval", comparisonName: "Creatinine", comparisonUnit: "mg/dL", confidence: "low", sourceText: "Creatinine 0.3" },
    { test: "Haemoglobin", value: "13.6", unit: "g/dL", refRange: "12–16", numericValue: 13.6, referenceLow: 12, referenceHigh: 16, referenceKind: "interval", comparisonName: "Haemoglobin", comparisonUnit: "g/dL", confidence: "high", sourceText: "Haemoglobin g/dL 13.6" }
  ]
};

const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".webp": "image/webp", ".css": "text/css; charset=utf-8", ".md": "text/plain; charset=utf-8" };

function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/analyze" && request.method === "POST") {
    if (String(request.headers.cookie || "").includes("spasht_fixture_error=plain")) {
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("An error occurred while processing the request");
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body || "{}");
    if (input.stage === "extract") return json(response, { extraction, provider: "Fixture" });
    if (String(request.headers.cookie || "").includes("spasht_fixture_error=timeout-explain")) {
      return json(response, { code: "analysis_timeout", error: "The analysis provider took too long. Please try again." }, 504);
    }
    const narrative = SCRIPT_FIXTURES[input.locale] || SCRIPT_FIXTURES.en;
    return json(response, {
      provider: "Fixture",
      report: {
        outputLocale: input.locale || "en", isMedical: true, overall: "ok", headline: narrative,
        subline: narrative, reportType: narrative,
        findings: (input.extraction?.findings || extraction.findings).map((finding, index) => ({ ...finding, test: index ? finding.test : narrative, meaningShort: narrative, status: index === 2 ? "low" : "normal", explain: index === 2 ? narrative : "", confirmed: true })),
        meaning: [narrative], questions: [narrative], lifestyle: [narrative], glossary: [{ term: narrative, definition: narrative }], urgencyTitle: narrative, urgencyNote: narrative
      }
    });
  }

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      let html = await readFile(join(root, "index.html"), "utf8");
      if (url.searchParams.get("demo") === "1") {
        html = html.replace("</script>", `\nlastExtraction=${JSON.stringify(extraction)};currentAnalysisId="fixture-report";requestExplanation(lastExtraction);\n</script>`);
      }
      const headers = { "Content-Type": mimeTypes[".html"] };
      if (url.searchParams.get("error") === "plain") headers["Set-Cookie"] = "spasht_fixture_error=plain; Path=/; SameSite=Lax";
      else if (url.searchParams.get("error") === "timeout-explain") headers["Set-Cookie"] = "spasht_fixture_error=timeout-explain; Path=/; SameSite=Lax";
      else headers["Set-Cookie"] = "spasht_fixture_error=; Path=/; Max-Age=0; SameSite=Lax";
      response.writeHead(200, headers);
      response.end(html);
      return;
    }
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
    const file = join(root, relative);
    if (!file.startsWith(root)) throw new Error("Invalid path");
    const data = await readFile(file);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(file)] || "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Spasht preview fixture: http://localhost:${port}/?demo=1`));

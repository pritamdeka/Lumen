import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 4_500_000;
const EXPORTED_ENV_KEYS = new Set(Object.keys(process.env));
const PUBLIC_ROOT_FILES = new Set([
  "index.html",
  "legal.css",
  "privacy.html",
  "terms.html",
  "medical-disclaimer.html",
  "contact.html"
]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

async function loadEnvironmentFile(name) {
  let source;
  try {
    source = await readFile(resolve(ROOT, name), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith("#") || EXPORTED_ENV_KEYS.has(match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

await loadEnvironmentFile(".env");
await loadEnvironmentFile(".env.local");

const [{ default: analyze }, { default: speech }] = await Promise.all([
  import("../api/analyze.js"),
  import("../api/speech.js")
]);

function addResponseHelpers(response) {
  response.status = code => {
    response.statusCode = code;
    return response;
  };
  response.json = value => {
    if (!response.headersSent) response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(value));
  };
  response.send = value => {
    response.end(value);
  };
}

async function readBody(request, response) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      response.status(413).json({ code: "payload_too_large", error: "Request payload too large" });
      return false;
    }
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString("utf8");
  if (!source) request.body = {};
  else {
    try {
      request.body = JSON.parse(source);
    } catch {
      request.body = source;
    }
  }
  return true;
}

async function serveStatic(pathname, request, response) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^[/\\]+/, "");
  const isPublic = PUBLIC_ROOT_FILES.has(relative) || /^src[/\\][A-Za-z0-9._-]+\.js$/.test(relative);
  if (!isPublic) return false;
  const filename = resolve(ROOT, relative);
  const rootPrefix = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
  if (!filename.startsWith(rootPrefix)) return false;
  try {
    const body = await readFile(filename);
    response.statusCode = 200;
    response.setHeader("Content-Type", MIME_TYPES[extname(filename)] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "HEAD") response.end();
    else response.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (request, response) => {
  addResponseHelpers(response);
  response.setHeader("X-Content-Type-Options", "nosniff");
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/api/analyze") {
      if (request.method === "POST" && !await readBody(request, response)) return;
      return await analyze(request, response);
    }
    if (url.pathname === "/api/speech") {
      if (request.method === "POST" && !await readBody(request, response)) return;
      return await speech(request, response);
    }
    if (["GET", "HEAD"].includes(request.method || "") && await serveStatic(url.pathname, request, response)) return;
    response.status(404).json({ code: "not_found", error: "Not found" });
  } catch {
    if (!response.headersSent) response.status(500).json({ code: "server_error", error: "Local server error" });
    else response.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Spasht local server: http://localhost:${PORT}`);
  console.log("Provider keys loaded from .env and .env.local; values are never printed.");
});

import { AZURE_VOICES, MAX_SPEECH_CHARS } from "../src/speech.js";
import { LOCALES } from "../src/locales.js";

export const config = { maxDuration: 30 };
const HITS = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

function rateLimited(ip) {
  const now = Date.now();
  const record = HITS.get(ip) || { count: 0, start: now };
  if (now - record.start > WINDOW_MS) { record.count = 0; record.start = now; }
  record.count++;
  HITS.set(ip, record);
  return record.count > MAX_PER_WINDOW;
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function normalizeSpeechRequest(body) {
  const value = body && typeof body === "object" ? body : {};
  const voice = LOCALES.some(locale => locale.code === value.locale && locale.enabled) ? AZURE_VOICES[value.locale] : null;
  if (!voice) { const error = new Error("Unsupported locale"); error.code = "unsupported_locale"; throw error; }
  if (typeof value.text !== "string" || !value.text.trim()) { const error = new Error("Missing narration text"); error.code = "missing_text"; throw error; }
  const text = value.text.trim();
  if (text.length > MAX_SPEECH_CHARS) { const error = new Error("Narration segment is too long"); error.code = "payload_too_large"; throw error; }
  return { locale: value.locale, text, ...voice };
}

export function buildSsml(input) {
  return `<speak version="1.0" xml:lang="${input.lang}"><voice name="${input.voice}"><prosody rate="-5%">${escapeXml(input.text)}</prosody></voice></speak>`;
}

function sendError(res, status, code, message) {
  res.status(status).json({ code, error: message });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Method not allowed");
  const ip = String(req.headers?.["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) return sendError(res, 429, "rate_limited", "Too many speech requests. Please wait a minute.");
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  let input;
  try { input = normalizeSpeechRequest(body); }
  catch (error) { return sendError(res, error.code === "payload_too_large" ? 413 : 400, error.code || "invalid_request", error.message); }

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region || !/^[a-z0-9-]+$/i.test(region)) return sendError(res, 503, "speech_not_configured", "Hosted speech is not configured");
  try {
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/ssml+xml",
        "Ocp-Apim-Subscription-Key": key,
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "Lumen"
      },
      body: buildSsml(input)
    });
    if (!response.ok) return sendError(res, 502, "speech_provider_failed", "Hosted speech is temporarily unavailable");
    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(audio.length));
    return res.status(200).send(audio);
  } catch {
    return sendError(res, 502, "speech_provider_failed", "Hosted speech is temporarily unavailable");
  }
}

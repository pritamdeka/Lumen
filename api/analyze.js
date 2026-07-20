// Lumen — /api/analyze  (Vercel serverless function, Node runtime)
// Keys live in Vercel Environment Variables — never sent to the browser.
//   GEMINI_API_KEY   (primary)
//   GROQ_API_KEY     (fallback 1)
//   DEEPINFRA_API_KEY(fallback 2)
//   OPENROUTER_API_KEY(fallback 3)

export const config = { maxDuration: 60 };

// ---- tiny in-memory rate limiter (per warm instance; best-effort) ----
const HITS = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
function rateLimited(ip) {
  const now = Date.now();
  const rec = HITS.get(ip) || { count: 0, start: now };
  if (now - rec.start > WINDOW_MS) { rec.count = 0; rec.start = now; }
  rec.count++;
  HITS.set(ip, rec);
  return rec.count > MAX_PER_WINDOW;
}

function buildPrompt(lang) {
  return `You are a careful medical communicator. A patient has uploaded an image of a medical document (lab report, prescription, or discharge summary). Read it carefully.

Your job is to TRANSLATE, not diagnose. Explain in ${lang}, at a level a person with no medical background understands. Be warm, calm and precise. Never invent values that are not visible. If the image is not a medical document, say so politely in the summary and leave arrays empty.

Safety rules:
- Do not diagnose conditions. Say what a value MAY relate to and that a doctor must interpret it.
- Never suggest medication changes.
- If any value looks critically abnormal, set overall "urgent" and advise prompt medical contact.

Respond with ONLY valid JSON, no markdown fences:
{
 "isMedical": true,
 "overall": "ok" | "attention" | "urgent",
 "headline": "one warm sentence summarising the report (max 18 words)",
 "subline": "one sentence of reassurance/context (max 20 words)",
 "reportType": "e.g. Complete Blood Count, Lipid Panel, Prescription",
 "findings": [{"test":"name","meaningShort":"3-6 word plain meaning","value":"number","unit":"unit","refRange":"range if shown","status":"normal|low|high|borderline|critical","explain":"one plain sentence, only for non-normal values, else empty string"}],
 "meaning": ["2-4 short paragraphs explaining the overall picture in plain language"],
 "questions": ["4-6 specific questions the patient should ask their doctor, referencing actual values"],
 "lifestyle": ["2-4 gentle, general wellbeing suggestions relevant to the findings; never medication advice"],
 "urgencyTitle": "short heading e.g. 'No urgent action needed' / 'See a doctor this week'",
 "urgencyNote": "1-2 sentences on recommended timing of follow-up, non-alarmist"
}`;
}

async function callGemini(key, prompt, b64, mime) {
  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key),
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
      }) });
  if (!r.ok) throw new Error("Gemini " + r.status);
  const j = await r.json();
  const t = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!t) throw new Error("Gemini empty");
  return t;
}

async function callOpenAICompat(name, url, key, model, prompt, b64, mime) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
      ] }],
      temperature: 0.4
    })
  });
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  const j = await r.json();
  const t = j.choices?.[0]?.message?.content;
  if (!t) throw new Error(`${name} empty`);
  return t;
}

function parseReport(txt) {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in model output");
  const j = JSON.parse(m[0]);
  if (typeof j.headline !== "string") throw new Error("bad shape");
  j.findings = Array.isArray(j.findings) ? j.findings : [];
  j.meaning = Array.isArray(j.meaning) ? j.meaning : [];
  j.questions = Array.isArray(j.questions) ? j.questions : [];
  j.lifestyle = Array.isArray(j.lifestyle) ? j.lifestyle : [];
  return j;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) { res.status(429).json({ error: "Too many requests. Please wait a minute." }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const { image, mime = "image/jpeg", language = "simple English" } = body || {};
  if (!image || typeof image !== "string") { res.status(400).json({ error: "Missing image data" }); return; }
  if (image.length > 8_000_000) { res.status(413).json({ error: "Image too large" }); return; }

  const prompt = buildPrompt(language);
  const providers = [
    { name: "Gemini", enabled: !!process.env.GEMINI_API_KEY,
      run: () => callGemini(process.env.GEMINI_API_KEY, prompt, image, mime) },
    { name: "Groq", enabled: !!process.env.GROQ_API_KEY,
      run: () => callOpenAICompat("Groq", "https://api.groq.com/openai/v1/chat/completions",
        process.env.GROQ_API_KEY, "meta-llama/llama-4-scout-17b-16e-instruct", prompt, image, mime) },
    { name: "DeepInfra", enabled: !!process.env.DEEPINFRA_API_KEY,
      run: () => callOpenAICompat("DeepInfra", "https://api.deepinfra.com/v1/openai/chat/completions",
        process.env.DEEPINFRA_API_KEY, "google/gemma-4-26B-A4B-it", prompt, image, mime) },
    { name: "OpenRouter", enabled: !!process.env.OPENROUTER_API_KEY,
      run: () => callOpenAICompat("OpenRouter", "https://openrouter.ai/api/v1/chat/completions",
        process.env.OPENROUTER_API_KEY, "qwen/qwen2.5-vl-72b-instruct:free", prompt, image, mime) }
  ].filter(p => p.enabled);

  if (providers.length === 0) {
    res.status(500).json({ error: "No AI provider configured. Set GEMINI_API_KEY (and optional backups) in Vercel env vars." });
    return;
  }

  let lastErr = null;
  for (const p of providers) {
    try {
      const raw = await p.run();
      const report = parseReport(raw);
      res.status(200).json({ report, provider: p.name });
      return;
    } catch (e) { lastErr = e; }
  }
  res.status(502).json({ error: "All AI providers failed", detail: String(lastErr?.message || lastErr) });
}

# Spasht

**Your medical report, finally in plain words.**

Upload a photo of a lab report, prescription, or discharge summary. Spasht explains every value in plain language, flags what needs attention, and prepares questions to ask your doctor in 18 supported languages.

Spasht translates. It does not diagnose.

---

## What it does

- **Reads any medical document photo** — lab reports, prescriptions, discharge summaries
- **Explains every value** with reference ranges and colour-coded status chips
- **Flags urgency** (ok / attention / urgent) with non-alarmist follow-up guidance
- **Generates doctor questions** referencing the patient's actual values, one tap to copy
- **18 languages** — English, हिन्दी, বাংলা, অসমীয়া, தமிழ், తెలుగు, मराठी, ಕನ್ನಡ, ગુજરાતી, മലയാളം, ਪੰਜਾਬੀ, ଓଡ଼ିଆ, اردو, Español, Français, Deutsch, Italiano, Português
- **Switch language on an existing report** without re-uploading
- **Multi-page upload** (up to 5 pages), drag-drop or paste from clipboard
- **Dark mode**, follows system preference
- **Local history** of the last 10 reports (stored in the browser only)
- **Print / save as PDF** to bring to an appointment
- **Natural read-aloud** through Azure neural speech, with a device-voice fallback
- **Complete extraction-first results** so values are not dropped when an explanation is incomplete

## Architecture

```
spasht-app/
├── index.html        # Frontend — single file, no build step
├── api/
│   └── analyze.js    # Vercel serverless function; holds the API keys
├── vercel.json       # Security headers
├── package.json
└── env.example.txt    # Environment variable template
```

**Key handling:** API keys live in Vercel environment variables and are read only inside the serverless function. They are never sent to the browser and never appear in client source. Users don't need their own keys.

**Provider routing** — both stages try the fastest capable provider first and fall back in order.

Extraction uses a compact line-based OCR prompt rather than the full JSON schema. Explanation is **staged**: per-finding
batches and one small narrative call run concurrently, so no single request has to carry the narrative *and* every
finding. A single combined call overruns both the time budget and the output budget once a report is long or the
target language is not Latin — that is what used to leave non-English reports with statuses but no summary.

| Stage | Order | Provider | Model | Notes |
|---|---|---|---|---|
| Extract | 1 | Google Gemini | `gemini-2.5-flash` | Line-based OCR, ~3 s per page |
| Extract | 2 | DeepInfra | `Qwen/Qwen3-VL-30B-A3B-Instruct` | Privacy-minimized OCR, pages in parallel |
| Extract | 3 | Groq / DeepInfra | generic model | Full JSON extraction schema |
| Explain | 1 | any configured | staged batches + narrative | Complete report; the normal path |
| Explain | 2 | any configured | single combined call | Legacy route, kept as a safety net |
| Explain | 3 | — | none | Neutral "not interpreted" report, values preserved |

Output budgets scale with the target script: Indic scripts spend roughly 1.8x the tokens of Latin for the same
sentence and Nastaliq about 2.2x, so a budget sized for English truncates every other language. Providers with a hard
per-request token cap are skipped for the staged pass on long reports rather than being allowed to burn the time
budget ahead of a provider that can finish.

If a provider produces the per-finding batches but not the narrative, that partial report is held while the remaining
providers are tried, and only returned if none of them can produce a complete one.

Configure at least one provider key. Providers whose keys are absent are skipped, so Gemini is optional when another provider is configured.

---

## Deploy to Vercel

### Option A — via GitHub (recommended)

1. Push this folder to a new GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
3. Framework preset: **Other**. Leave build command and output directory empty.
4. Add environment variables (Settings → Environment Variables):

   | Name | Value | Required |
   |---|---|---|
   | `GEMINI_API_KEY` | your Gemini key | optional if another analysis provider is configured |
   | `GROQ_API_KEY` | your Groq key | optional |
   | `DEEPINFRA_API_KEY` | your DeepInfra key | optional |
   | `AZURE_SPEECH_KEY` | Azure Speech resource key | optional; enables natural narration |
   | `AZURE_SPEECH_REGION` | Azure region, for example `uksouth` | required with the speech key |

5. Deploy. Done — no build step, no database.

### Option B — via CLI

```bash
npm i -g vercel
cd spasht-app
vercel                      # link the project
vercel env add GEMINI_API_KEY
vercel env add GROQ_API_KEY          # optional
vercel env add DEEPINFRA_API_KEY     # optional
vercel env add AZURE_SPEECH_KEY      # optional
vercel env add AZURE_SPEECH_REGION   # required with speech key
vercel --prod
```

### Run locally

```bash
cp env.example.txt .env.local  # fill in at least one analysis-provider key
npm run dev                    # serves the site and local APIs on http://localhost:3000
```

The zero-dependency local server loads `.env` followed by `.env.local`; values already exported in the terminal take precedence. It emulates the response helpers used by the Vercel functions and never serves environment files. Vercel CLI is not required for local development.

Run the zero-dependency test suite with `npm test`. It validates every provider request and response contract, fallback handling, malformed output handling, and both analysis stages without making billable network calls. Production exposes only locales with a current approved catalog checksum.

Run `npm run review:translations:check` for deterministic catalog checks. Put the DeepInfra key in ignored `key.txt` (or set `DEEPINFRA_API_KEY` in ignored `.env.local`), then run `npm run review:translations` for the paid dual-model semantic review. Gemma and Qwen review independently, Gemma 31B adjudicates disagreements, corrections are stored in a generated override file, and `docs/translation-review.md` records the method, date, correction count, and checksum. These are explicitly AI/API reviews; later human feedback is welcome but does not block the beta.

After exporting provider keys in your terminal, run `npm run test:providers:live` for an opt-in live smoke test. It validates both extraction and explanation, reports their latency, and sends only a generated blank test image—never a medical report. Do not paste API keys into source files, issues, or chat.

For an explicitly authorized local report fixture, run `npm run test:report:local -- path/to/report.webp` while the local server is running. The command reports only stage, status, latency, provider, and finding count; it never prints extracted text.

Analysis uses two stages: the first extracts every visible value and assigns a stable ID; the second explains those IDs. The extraction remains authoritative, so omitted or reordered explanation items cannot hide reported values.

Analysis functions have a 120-second ceiling and the browser aborts a stalled request at 125 seconds, so a stuck provider always surfaces as an error rather than an endless spinner. OCR processes uploaded pages concurrently, excludes identity fields from its requested transcription, and uses a 1,200-token per-page limit. Batched explanations are split into parallel groups of at most 12 findings, with original values merged back by stable ID. Generic fallback attempts share an 80-second internal deadline. Output budgets are sized from page and finding counts — an undersized budget makes a provider truncate mid-JSON, which is indistinguishable from an outage. Groq requests are additionally capped to stay inside its per-minute token allowance, which rejects oversized requests outright. Gemini thinking and DeepInfra/Qwen reasoning are disabled for these structured workflows.

A typical single-page report completes in about 25 seconds end to end: ~3 s to extract and ~20 s to explain.

If extraction succeeds but explanation times out, Spasht keeps every extracted value visible in a neutral “not interpreted” state. The user can retry the explanation without uploading or extracting the report again.

`GET /api/analyze` returns a credential-free diagnostic showing the configured provider names, model IDs, and timeout budgets. It never calls a provider or exposes a key.

Opening `index.html` directly as a file will not work—the browser must use the local server so `/api/analyze` is available.

---

## Where to get keys

| Provider | URL | Free tier |
|---|---|---|
| Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Free tier is **20 requests/day** for `gemini-2.5-flash` |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | Free, but only 8,000 tokens/minute |
| DeepInfra | [deepinfra.com/dash/api_keys](https://deepinfra.com/dash/api_keys) | Pay-as-you-go, very cheap |

Check your real quota at [ai.dev/rate-limit](https://ai.dev/rate-limit) before relying on it. On the free tier a single
analysis spends two Gemini requests, so **20 requests/day is roughly ten reports per day for the whole deployment** —
enough for development, not for a public launch. Enabling billing on the Google Cloud project moves the key to the paid
tier and lifts the cap. Once the Gemini quota is spent, every request falls through to DeepInfra and Groq: reports still
complete, but end-to-end latency roughly doubles.

---

## Safety design

The system prompt constrains the model to translation, not diagnosis:

- Never invents values not visible in the image
- States what a value *may* relate to, and that a clinician must interpret it
- Never suggests medication changes
- Escalates to `urgent` if any value looks critically abnormal
- Politely declines if the uploaded image isn't a medical document

The UI reinforces this with a persistent disclaimer and framing throughout ("not a diagnosis — a translation").

## Privacy

- Images are sent to the AI provider for analysis and are **not stored** on the server
- No database, no accounts, no analytics
- History is stored in the browser's `localStorage` only, and can be cleared in one tap
- Upload processing starts only after explicit consent, which can be withdrawn from the site footer.
- Hosted narration is opt-in. Only explanation text—not the report image—is sent to Azure Speech, and generated audio is kept in memory only.
- Rate limiting: 20 requests per minute per IP
- Public beta notices are available at `/privacy.html`, `/terms.html`, `/medical-disclaimer.html`, and `/contact.html`.

---

## Roadmap ideas

- PDF upload with client-side page extraction (pdf.js)
- Trend tracking across multiple reports over time
- Shareable read-only report links (with explicit consent step)
- Voice-read explanation for low-literacy users
- WhatsApp entry point for the Indian market

## Disclaimer

Spasht is not a medical device and does not provide medical advice. It is an accessibility tool that translates medical documents into plain language. Always consult a qualified clinician about your results.

# Lumen

**Your medical report, finally in plain words.**

Upload a photo of a lab report, prescription, or discharge summary. Lumen explains every value in plain language, flags what needs attention, and prepares questions to ask your doctor in 18 supported languages.

Lumen translates. It does not diagnose.

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
lumen-app/
├── index.html        # Frontend — single file, no build step
├── api/
│   └── analyze.js    # Vercel serverless function; holds the API keys
├── vercel.json       # Security headers
├── package.json
└── env.example.txt    # Environment variable template
```

**Key handling:** API keys live in Vercel environment variables and are read only inside the serverless function. They are never sent to the browser and never appear in client source. Users don't need their own keys.

**Provider fallback chain** — the backend tries each in order until one succeeds:

| Order | Provider | Model | Notes |
|---|---|---|---|
| 1 | Google Gemini | `gemini-2.5-flash` | Native structured JSON |
| 2 | Groq | `qwen/qwen3.6-27b` | Vision and JSON object mode |
| 3 | DeepInfra | `google/gemma-4-26B-A4B-it` | Vision and JSON object mode |

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
cd lumen-app
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
cp env.example.txt .env     # fill in your keys
vercel dev                  # serves on http://localhost:3000
```

Run the zero-dependency test suite with `npm test`. It validates every provider request and response contract, fallback handling, malformed output handling, and both analysis stages without making billable network calls. Production exposes only locales with a current approved catalog checksum.

Run `npm run review:translations:check` for deterministic catalog checks. Put the DeepInfra key in ignored `key.txt` (or set `DEEPINFRA_API_KEY` in ignored `.env.local`), then run `npm run review:translations` for the paid dual-model semantic review. Gemma and Qwen review independently, Gemma 31B adjudicates disagreements, corrections are stored in a generated override file, and `docs/translation-review.md` records the method, date, correction count, and checksum. These are explicitly AI/API reviews; later human feedback is welcome but does not block the beta.

After exporting provider keys in your terminal, run `npm run test:providers:live` for an opt-in live smoke test. It validates both extraction and explanation, reports their latency, and sends only a generated blank test image—never a medical report. Do not paste API keys into source files, issues, or chat.

Analysis uses two stages: the first extracts every visible value and assigns a stable ID; the second explains those IDs. The extraction remains authoritative, so omitted or reordered explanation items cannot hide reported values.

Analysis functions have a 60-second ceiling and a 55-second internal deadline. Attempts are capped at 15 seconds for Gemini, 12 seconds for Groq, and 35 seconds for DeepInfra, while also respecting a fair share of the remaining deadline. A stalled provider therefore falls back quickly enough for the next provider to run, while the slower final provider has a practical window when it is configured alone or earlier providers fail quickly. Gemini thinking is disabled for this extraction workflow to reduce latency.

`GET /api/analyze` returns a credential-free diagnostic showing the configured provider names, model IDs, and timeout budgets. It never calls a provider or exposes a key.

Opening `index.html` directly as a file will not work — `/api/analyze` needs the Vercel runtime.

---

## Where to get keys

| Provider | URL | Free tier |
|---|---|---|
| Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | 1,500 req/day, no card |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | Yes, generous |
| DeepInfra | [deepinfra.com/dash/api_keys](https://deepinfra.com/dash/api_keys) | Pay-as-you-go, very cheap |

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

Lumen is not a medical device and does not provide medical advice. It is an accessibility tool that translates medical documents into plain language. Always consult a qualified clinician about your results.

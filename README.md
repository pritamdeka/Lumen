# Lumen

**Your medical report, finally in plain words.**

Upload a photo of a lab report, prescription, or discharge summary. Lumen explains every value in plain language, flags what needs attention, and prepares the questions to ask your doctor — in English or 12 Indian languages.

Lumen translates. It does not diagnose.

---

## What it does

- **Reads any medical document photo** — lab reports, prescriptions, discharge summaries
- **Explains every value** with reference ranges and colour-coded status chips
- **Flags urgency** (ok / attention / urgent) with non-alarmist follow-up guidance
- **Generates doctor questions** referencing the patient's actual values, one tap to copy
- **13 languages** — English, हिन्दी, বাংলা, অসমীয়া, தமிழ், తెలుగు, मराठी, ಕನ್ನಡ, ગુજરાતી, മലയാളം, ਪੰਜਾਬੀ, ଓଡିଆ, اردو
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
└── .env.example      # Environment variable template
```

**Key handling:** API keys live in Vercel environment variables and are read only inside the serverless function. They are never sent to the browser and never appear in client source. Users don't need their own keys.

**Provider fallback chain** — the backend tries each in order until one succeeds:

| Order | Provider | Model | Notes |
|---|---|---|---|
| 1 | Google Gemini | `gemini-2.5-flash` | Free tier, 1,500 req/day |
| 2 | Groq | `llama-4-scout-17b-16e-instruct` | Free tier, very fast |
| 3 | DeepInfra | `google/gemma-4-26B-A4B-it` | MoE, ~$0.07/1M input |
| 4 | OpenRouter | `qwen2.5-vl-72b-instruct:free` | Free tier |

Only `GEMINI_API_KEY` is required; any provider whose key is absent is skipped.

---

## Deploy to Vercel

### Option A — via GitHub (recommended)

1. Push this folder to a new GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
3. Framework preset: **Other**. Leave build command and output directory empty.
4. Add environment variables (Settings → Environment Variables):

   | Name | Value | Required |
   |---|---|---|
   | `GEMINI_API_KEY` | your Gemini key | yes |
   | `GROQ_API_KEY` | your Groq key | optional |
   | `DEEPINFRA_API_KEY` | your DeepInfra key | optional |
| `OPENROUTER_API_KEY` | your OpenRouter key | optional |
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
vercel env add OPENROUTER_API_KEY    # optional
vercel env add AZURE_SPEECH_KEY      # optional
vercel env add AZURE_SPEECH_REGION   # required with speech key
vercel --prod
```

### Run locally

```bash
cp .env.example .env        # fill in your keys
vercel dev                  # serves on http://localhost:3000
```

Run the zero-dependency test suite with `npm test`. The existing 13 languages remain available. Spanish, French, German, Italian, and European Portuguese are included as disabled drafts until native-speaker sign-off in `docs/translation-review.md`.

Analysis uses two stages: the first extracts every visible value and assigns a stable ID; the second explains those IDs. The extraction remains authoritative, so omitted or reordered explanation items cannot hide reported values.

Opening `index.html` directly as a file will not work — `/api/analyze` needs the Vercel runtime.

---

## Where to get keys

| Provider | URL | Free tier |
|---|---|---|
| Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | 1,500 req/day, no card |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | Yes, generous |
| DeepInfra | [deepinfra.com/dash/api_keys](https://deepinfra.com/dash/api_keys) | Pay-as-you-go, very cheap |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | Yes, limited |

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
- Hosted narration is opt-in. Only explanation text—not the report image—is sent to Azure Speech, and generated audio is kept in memory only.
- Rate limiting: 20 requests per minute per IP

---

## Roadmap ideas

- PDF upload with client-side page extraction (pdf.js)
- Trend tracking across multiple reports over time
- Shareable read-only report links (with explicit consent step)
- Voice-read explanation for low-literacy users
- WhatsApp entry point for the Indian market

## Disclaimer

Lumen is not a medical device and does not provide medical advice. It is an accessibility tool that translates medical documents into plain language. Always consult a qualified clinician about your results.

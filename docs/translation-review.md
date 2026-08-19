# Translation Review Checklist

Production activation is determined by an auditable AI/API review and a matching SHA-256 catalog checksum. These records are not represented as native-human review. Human feedback remains welcome after release.

Reviewers: `google/gemma-4-26B-A4B-it`, `Qwen/Qwen3.6-35B-A3B`
Adjudicator: `google/gemma-4-31B-it`

| Locale | Language | Method | Date | Corrections | Status | Catalog SHA-256 |
|---|---|---|---|---:|---|---|
| `en` | English | project-baseline | 2026-08-19 | 0 | approved | `a4cd4b683df2…` |
| `hi` | हिन्दी | deepinfra-dual-model | 2026-07-24 | 41 | approved | `16fad56a6d57…` |
| `bn` | বাংলা | deepinfra-dual-model | 2026-07-24 | 36 | approved | `606492ee6a6d…` |
| `as` | অসমীয়া | deepinfra-dual-model + human-correction | 2026-08-19 | 37 | approved | `8f4468fff479…` |
| `ta` | தமிழ் | deepinfra-dual-model | 2026-07-24 | 32 | approved | `06d606adb10a…` |
| `te` | తెలుగు | deepinfra-dual-model | 2026-07-25 | 39 | approved | `b8ead34fbd4b…` |
| `mr` | मराठी | deepinfra-dual-model + human-correction | 2026-08-19 | 43 | approved | `b3e0ea83bd5e…` |
| `kn` | ಕನ್ನಡ | deepinfra-dual-model | 2026-07-25 | 37 | approved | `aa19c5f89d2a…` |
| `gu` | ગુજરાતી | deepinfra-dual-model | 2026-07-25 | 33 | approved | `066f3399eac6…` |
| `ml` | മലയാളം | deepinfra-dual-model | 2026-07-24 | 35 | approved | `e3f1ac30e3ac…` |
| `pa` | ਪੰਜਾਬੀ | deepinfra-dual-model + human-correction | 2026-08-19 | 37 | approved | `e3d9c24fe0d6…` |
| `or` | ଓଡ଼ିଆ | deepinfra-dual-model | 2026-07-25 | 48 | approved | `9cc4c989f755…` |
| `ur` | اردو | deepinfra-dual-model | 2026-07-25 | 27 | approved | `52ee2dbd095b…` |
| `es` | Español | deepinfra-dual-model | 2026-07-25 | 75 | approved | `72ea37e0c7a3…` |
| `fr` | Français | deepinfra-dual-model | 2026-07-25 | 71 | approved | `e96c1e7ba7c9…` |
| `de` | Deutsch | deepinfra-dual-model | 2026-07-25 | 73 | approved | `97f698536eee…` |
| `it` | Italiano | deepinfra-dual-model | 2026-07-25 | 72 | approved | `3271b8d623d8…` |
| `pt-PT` | Português | deepinfra-dual-model | 2026-07-25 | 74 | approved | `bb8fefc01760…` |

Automated release checks cover:

- Complete interface-key coverage with no changed placeholders.
- Natural, calm, medically neutral wording without diagnosis or treatment claims.
- Status labels, validation messages, controls, consent, privacy, and safety disclaimers.
- Expected writing system, Urdu direction, numbers, units, file types, and medical abbreviations.
- Accessibility-label intent and concise mobile-friendly wording.

A catalog edit changes its checksum and immediately removes that locale from production until this review is run again.

## Hand corrections

Rows marked `+ human-correction` carry a later hand edit on top of the model review, with the checksum re-stamped so the locale stays in production. Recorded corrections:

- 2026-08-19 — `en`: "Your numbers" became "Your results" (every other locale already said results); the file-type error stopped pleading ("Please upload JPG or PNG images." → "Upload a JPG or PNG image."); and the range label stopped using the lab abbreviation `ref` in a product whose purpose is removing lab jargon.
- 2026-08-19 — `as`, `mr`, `pa`: the drop-zone label used a verb that also reads as "throw away" or "abandon" (`পেলাওক`, `टाका`, `ਛੱਡੋ`). Replaced with a plain "place here" verb (`ৰাখক`, `ठेवा`, `ਰੱਖੋ`). Assamese was reported by a native speaker; Marathi and Punjabi were changed for the same connotation and are worth a native-speaker check.

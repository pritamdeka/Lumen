# Translation Review Checklist

Production activation is determined by an auditable AI/API review and a matching SHA-256 catalog checksum. These records are not represented as native-human review. Human feedback remains welcome after release.

Reviewers: `google/gemma-4-26B-A4B-it`, `Qwen/Qwen3.6-35B-A3B`
Adjudicator: `google/gemma-4-31B-it`

| Locale | Language | Method | Date | Corrections | Status | Catalog SHA-256 |
|---|---|---|---|---:|---|---|
| `en` | English | project-baseline | 2026-08-19 | 0 | approved | `1b079fd6882a…` |
| `hi` | हिन्दी | deepinfra-dual-model | 2026-07-24 | 41 | approved | `db4fa4d8a7bc…` |
| `bn` | বাংলা | deepinfra-dual-model | 2026-07-24 | 36 | approved | `32e57e1d743c…` |
| `as` | অসমীয়া | deepinfra-dual-model + human-correction | 2026-08-19 | 37 | approved | `e40402820b13…` |
| `ta` | தமிழ் | deepinfra-dual-model | 2026-07-24 | 32 | approved | `726c04a70523…` |
| `te` | తెలుగు | deepinfra-dual-model | 2026-07-25 | 39 | approved | `5d32b4bd5951…` |
| `mr` | मराठी | deepinfra-dual-model + human-correction | 2026-08-19 | 43 | approved | `d49c987635b4…` |
| `kn` | ಕನ್ನಡ | deepinfra-dual-model | 2026-07-25 | 37 | approved | `8d2daa7b04a7…` |
| `gu` | ગુજરાતી | deepinfra-dual-model | 2026-07-25 | 33 | approved | `733fe3ccdbcf…` |
| `ml` | മലയാളം | deepinfra-dual-model | 2026-07-24 | 35 | approved | `7438745ef439…` |
| `pa` | ਪੰਜਾਬੀ | deepinfra-dual-model + human-correction | 2026-08-19 | 37 | approved | `94acb2a5fdb9…` |
| `or` | ଓଡ଼ିଆ | deepinfra-dual-model | 2026-07-25 | 48 | approved | `4bcab5028939…` |
| `ur` | اردو | deepinfra-dual-model | 2026-07-25 | 27 | approved | `54c8665d2d0c…` |
| `es` | Español | deepinfra-dual-model | 2026-07-25 | 75 | approved | `4cb478836c4f…` |
| `fr` | Français | deepinfra-dual-model | 2026-07-25 | 71 | approved | `c0b597531cb2…` |
| `de` | Deutsch | deepinfra-dual-model | 2026-07-25 | 73 | approved | `daca59517c27…` |
| `it` | Italiano | deepinfra-dual-model | 2026-07-25 | 72 | approved | `e3816ee694ce…` |
| `pt-PT` | Português | deepinfra-dual-model | 2026-07-25 | 74 | approved | `578fdea9c936…` |

Automated release checks cover:

- Complete interface-key coverage with no changed placeholders.
- Natural, calm, medically neutral wording without diagnosis or treatment claims.
- Status labels, validation messages, controls, consent, privacy, and safety disclaimers.
- Expected writing system, Urdu direction, numbers, units, file types, and medical abbreviations.
- Accessibility-label intent and concise mobile-friendly wording.

A catalog edit changes its checksum and immediately removes that locale from production until this review is run again.

## Renames

- 2026-08-20 — the product was renamed from Lumen to Spasht. The brand name appears inside translated
  sentences in every catalog, so all 18 checksums were re-stamped. No wording was re-reviewed and the
  reviewer records are unchanged: this was a proper-noun substitution, not a retranslation.

## Hand corrections

Rows marked `+ human-correction` carry a later hand edit on top of the model review, with the checksum re-stamped so the locale stays in production. Recorded corrections:

- 2026-08-19 — `en`: "Your numbers" became "Your results" (every other locale already said results); the file-type error stopped pleading ("Please upload JPG or PNG images." → "Upload a JPG or PNG image."); and the range label stopped using the lab abbreviation `ref` in a product whose purpose is removing lab jargon.
- 2026-08-19 — `as`, `mr`, `pa`: the drop-zone label used a verb that also reads as "throw away" or "abandon" (`পেলাওক`, `टाका`, `ਛੱਡੋ`). Replaced with a plain "place here" verb (`ৰাখক`, `ठेवा`, `ਰੱਖੋ`). Assamese was reported by a native speaker; Marathi and Punjabi were changed for the same connotation and are worth a native-speaker check.

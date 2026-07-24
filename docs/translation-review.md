# Translation Review Checklist

Production activation is determined by an auditable AI/API review and a matching SHA-256 catalog checksum. These records are not represented as native-human review. Human feedback remains welcome after release.

Reviewers: `google/gemma-4-26B-A4B-it`, `Qwen/Qwen3.6-35B-A3B`
Adjudicator: `google/gemma-4-31B-it`

| Locale | Language | Method | Date | Corrections | Status | Catalog SHA-256 |
|---|---|---|---|---:|---|---|
| `en` | English | Project baseline | 2026-07-20 | 0 | Approved | `58b5a613f4c3…` |
| `hi` | हिन्दी | Awaiting API review | — | 0 | Draft | — |
| `bn` | বাংলা | Awaiting API review | — | 0 | Draft | — |
| `as` | অসমীয়া | Awaiting API review | — | 0 | Draft | — |
| `ta` | தமிழ் | Awaiting API review | — | 0 | Draft | — |
| `te` | తెలుగు | Awaiting API review | — | 0 | Draft | — |
| `mr` | मराठी | Awaiting API review | — | 0 | Draft | — |
| `kn` | ಕನ್ನಡ | Awaiting API review | — | 0 | Draft | — |
| `gu` | ગુજરાતી | Awaiting API review | — | 0 | Draft | — |
| `ml` | മലയാളം | Awaiting API review | — | 0 | Draft | — |
| `pa` | ਪੰਜਾਬੀ | Awaiting API review | — | 0 | Draft | — |
| `or` | ଓଡ଼ିଆ | Awaiting API review | — | 0 | Draft | — |
| `ur` | اردو | Awaiting API review | — | 0 | Draft | — |
| `es` | Español | Awaiting API review | — | 0 | Draft | — |
| `fr` | Français | Awaiting API review | — | 0 | Draft | — |
| `de` | Deutsch | Awaiting API review | — | 0 | Draft | — |
| `it` | Italiano | Awaiting API review | — | 0 | Draft | — |
| `pt-PT` | Português | Awaiting API review | — | 0 | Draft | — |

Automated release checks cover:

- Complete interface-key coverage with no changed placeholders.
- Natural, calm, medically neutral wording without diagnosis or treatment claims.
- Status labels, validation messages, controls, consent, privacy, and safety disclaimers.
- Expected writing system, Urdu direction, numbers, units, file types, and medical abbreviations.
- Accessibility-label intent and concise mobile-friendly wording.

Run `npm run review:translations` after configuring `DEEPINFRA_API_KEY`. A catalog edit changes its checksum and immediately removes that locale from production until the review is run again.

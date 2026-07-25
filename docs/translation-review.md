# Translation Review Checklist

Production activation is determined by an auditable AI/API review and a matching SHA-256 catalog checksum. These records are not represented as native-human review. Human feedback remains welcome after release.

Reviewers: `google/gemma-4-26B-A4B-it`, `Qwen/Qwen3.6-35B-A3B`
Adjudicator: `google/gemma-4-31B-it`

| Locale | Language | Method | Date | Corrections | Status | Catalog SHA-256 |
|---|---|---|---|---:|---|---|
| `en` | English | project-baseline | 2026-07-20 | 0 | approved | `58b5a613f4c3…` |
| `hi` | हिन्दी | deepinfra-dual-model | 2026-07-24 | 41 | approved | `16fad56a6d57…` |
| `bn` | বাংলা | deepinfra-dual-model | 2026-07-24 | 36 | approved | `606492ee6a6d…` |
| `as` | অসমীয়া | deepinfra-dual-model | 2026-07-24 | 36 | approved | `d309dcb68040…` |
| `ta` | தமிழ் | deepinfra-dual-model | 2026-07-24 | 32 | approved | `06d606adb10a…` |
| `te` | తెలుగు | deepinfra-dual-model | 2026-07-25 | 39 | approved | `b8ead34fbd4b…` |
| `mr` | मराठी | deepinfra-dual-model | 2026-07-25 | 42 | approved | `a3f2d4674ec6…` |
| `kn` | ಕನ್ನಡ | deepinfra-dual-model | 2026-07-25 | 37 | approved | `aa19c5f89d2a…` |
| `gu` | ગુજરાતી | deepinfra-dual-model | 2026-07-25 | 33 | approved | `066f3399eac6…` |
| `ml` | മലയാളം | deepinfra-dual-model | 2026-07-24 | 35 | approved | `e3f1ac30e3ac…` |
| `pa` | ਪੰਜਾਬੀ | deepinfra-dual-model | 2026-07-25 | 36 | approved | `654143fba7e1…` |
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

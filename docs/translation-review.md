# Translation Review Checklist

All non-English interface translations are drafts until a native reviewer signs off. Update `reviewed` in `src/locales.js` only after completing this checklist.

| Locale | Language | Reviewer | Date | Status |
|---|---|---|---|---|
| `en` | English | Project baseline | 2026-07-20 | Reviewed |
| `hi` | Hindi | — | — | Draft |
| `bn` | Bengali | — | — | Draft |
| `as` | Assamese | — | — | Draft |
| `ta` | Tamil | — | — | Draft |
| `te` | Telugu | — | — | Draft |
| `mr` | Marathi | — | — | Draft |
| `kn` | Kannada | — | — | Draft |
| `gu` | Gujarati | — | — | Draft |
| `ml` | Malayalam | — | — | Draft |
| `pa` | Punjabi (Gurmukhi) | — | — | Draft |
| `or` | Odia | — | — | Draft |
| `ur` | Urdu | — | — | Draft |

For each locale, verify:

- Wording is natural, calm, and medically neutral; it does not imply diagnosis or treatment.
- Every control, validation message, status label, history state, and disclaimer is translated.
- Long text wraps at 320 px width and remains readable in light and dark themes.
- Print output is legible; Urdu direction and mixed-direction numbers/units are correct.
- Keyboard focus order, accessible names, and screen-reader reading order remain logical.

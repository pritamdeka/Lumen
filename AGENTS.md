# Repository Guidelines

## Project Structure & Module Organization

Lumen is a build-free Vercel application. `index.html` contains the browser UI, including styles, localization, uploads, report rendering, history, and themes. `api/analyze.js` is the Node.js serverless endpoint that validates requests and calls configured AI providers in fallback order. `vercel.json` defines security headers, while `.env.example` documents provider keys. Keep `README.md` aligned with behavior changes.

## Build, Test, and Development Commands

- `npm run dev` starts `vercel dev`, normally at `http://localhost:3000`; use this instead of opening `index.html` directly because the UI requires `/api/analyze`.
- `npm run deploy` performs a production Vercel deployment. Run it only when the target project and environment variables have been verified.
- `vercel env pull .env.local` can populate local configuration after the project is linked. Never commit the resulting file.

The project has no compile step or runtime dependencies. Install the Vercel CLI separately if `vercel` is unavailable. Run `npm test` for the zero-dependency Node test suite.

## Coding Style & Naming Conventions

Use modern ES modules and browser APIs supported by Node 18+. Follow the existing two-space indentation in JavaScript and JSON. Prefer `const`, short focused functions, early validation returns, and semicolon-terminated statements. Use `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants, and descriptive lowercase CSS class names. Preserve the single-file frontend organization unless a larger refactor is agreed upon. No formatter or linter is currently configured, so keep edits consistent with surrounding code.

## Testing Guidelines

Tests use Node's built-in `node:test` runner. Place tests under `test/`, name them `*.test.js`, and keep language fixtures in `test-fixtures/`. Run `npm test` before submitting. Also run `npm run dev` and manually verify uploads, provider fallback, language direction, dark mode, history, and print output as relevant. There is no coverage threshold yet.

## Commit & Pull Request Guidelines

History is limited but uses short imperative summaries such as `Create env.example.txt` and `Update index.html`. Prefer more specific subjects, for example `Validate provider response shape`. Keep each commit focused. Pull requests should explain user-visible and API changes, list manual verification performed, link related issues, and include screenshots for UI changes. Call out environment-variable or deployment changes explicitly.

## Security & Configuration

Keep all provider keys in Vercel environment variables or ignored `.env` files. Never expose keys in `index.html`, logs, fixtures, or screenshots. Maintain the product boundary: explain medical documents without diagnosing or recommending medication changes.

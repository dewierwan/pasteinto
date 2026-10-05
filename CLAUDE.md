# Paste Into

Paste anything, pick where it's going, and the result is copied. The site at pasteinto.com and the Chrome extension popup are the same static files. There is no build step.

## Design

Read `DESIGN.md` before any visual change (CSS, layout, page copy, icons, store images). The look follows iA (ia.net): reduction, typography first, quiet surfaces and one sparing accent.

## Commands

- **Run it:** open `index.html` in a browser.
- **Tests:** `npm test` (vitest + jsdom; `tests/load.js` loads the scripts in `index.html` order).
- **Rewrite expected outputs after an intended change:** `npm run test:update`, then review the diff.
- **Type check:** `npm run typecheck` (tsc over JSDoc; no compiling).
- **Lint and format:** `npm run lint`, `npm run format` (`npm run format:check` in CI).
- **Spelling and HTML:** `npm run lint:spell`, `npm run lint:html`.
- **Save a real paste as a fixture:** copy it, then `npm run capture -- <folder>/<name>` (macOS; `npm run capture` alone opens a page to paste into).
- **Pack the extension:** `npm run pack:extension`.

CI runs format check, lint, type check, spelling, HTML validation and tests on every push and pull request.

## How it works

Every paste goes through three steps (`js/convert.js`):

1. **Read** into HTML. Rich text is used as is, Markdown goes through `js/vendor/marked.umd.js`, PDF text goes through `js/from-pdf.js`, and Slack's message box (which copies no HTML) goes through `js/from-slack.js`. `js/sources.js` lists the apps (detection rule, name, paragraph spacing) and rewrites each app's quirks into plain HTML.
2. **Clean** with `js/clean-html.js` into a small, predictable subset. The cleaner knows nothing about specific apps.
3. **Write** the output. `js/to-markdown.js` writes Markdown and `js/to-text.js` writes WhatsApp and plain text. Email & Slack and Docs use the cleaned HTML itself.

`js/app.js` wires up the page, `js/analytics.js` sends anonymous counts and `js/extension.js` adjusts the page when it runs as the extension popup.

### Where a change goes

- **A quirk of one app** (odd markup, flat lists, hidden formatting) goes in that app's `fix` in `js/sources.js`. Don't add app checks to the cleaner or the writers.
- **A new app** gets an entry in `APPS` in `js/sources.js` and a fixture.
- **A new output** gets a writer that reads the cleaner's output, plus a case in `convertClip`.

## Code conventions

- Each script is a classic script wrapped in `(function (root) { ... })(globalThis)` that attaches its public functions to `globalThis`. Declare each new shared function in `types/globals.d.ts` and `eslint.config.mjs`.
- When adding a script, add it to `index.html` and `tests/load.js`, and to the page in `scripts/capture-fixture.mjs` if detection needs it.
- Shared helpers (`escapeHtml`, `escapeAttr`, `wrapMarkers`) live in `js/util.js`. Reuse them rather than copying.
- Prettier sets the style for JavaScript and JSON: single quotes, trailing commas, 140 columns. CSS and HTML are formatted by hand.
- Comments explain why, in plain English, with a real example where it helps ("Gmail writes `<div>Hi Sam,<div><br></div>…`").
- Give thresholds a named constant with a one-line reason.
- Parse pasted HTML only with `DOMParser`, never `innerHTML` on an element of the live page: browsers run event handlers in it. A test checks this.
- Third-party code lives unmodified in `js/vendor/` (currently marked, MIT).

## Tests

- Unit tests are in `tests/*.test.js`.
- `tests/fixtures.test.js` runs every fixture through detection and all five outputs, and compares the results with the expected files saved next to it. `tests/fixtures/README.md` explains the format and which fixtures are hand-built.
- Prefer a real capture (`npm run capture`) over a hand-written fixture.
- `tests/destinations.test.js` checks what Notion, Airtable, Google Docs, Slack and Gmail make of the Docs and Email & Slack outputs. If you change either output's HTML, it fails until the real apps are re-checked: follow `tests/destinations/README.md`.

## The extension and releases

- `index.html` is also the extension popup (`manifest.json`). Keep it free of inline scripts, inline event handlers and remote code, which extensions refuse; a test checks this. Popup-only styles go under `html.is-extension`, set by `js/extension.js`.
- `index.html` sets a Content-Security-Policy. A new remote connection (like Umami's `connect-src`) or image source needs adding there.
- After changing any file in `css/` or `js/`, run `npm run stamp`. It updates the `?v=` content hashes in `index.html` so browsers don't mix new and cached files. A test fails if you forget.
- To release: bump `version` in `manifest.json`, run `npm run pack:extension`, upload the zip to the Chrome Web Store, then push a tag `v<version>`. CI attaches the zip to a GitHub release.
- Pushing to `main` deploys the site through GitHub Pages.

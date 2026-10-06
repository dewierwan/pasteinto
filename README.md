# Paste Into

Paste anything. Pick where it's going. The result is copied automatically.

Live at **[pasteinto.com](https://pasteinto.com)**. (The old paste-to.md redirects here.)

Every app puts its own clutter on the clipboard: Google Docs' span soup, Notion's wrapping divs, Word's `Mso` styles, Claude's raw Markdown asterisks, a PDF's line break at the end of every line. This page reads any of them and writes one of five outputs:

| Output | For |
|---|---|
| Markdown | Claude, ChatGPT, GitHub, Obsidian, Notion |
| Email & Slack | Gmail, Outlook, Slack, Teams. Headings become bold lines, since these apps have no headings |
| Docs | Google Docs, Word, Notion, Airtable. Like Email & Slack, but keeps headings at their original level. Checklists become real to-dos in Notion and Airtable, and square bullets in Google Docs |
| WhatsApp | WhatsApp, Signal. Formatting becomes `*bold*`, `_italic_` and `~strike~` |
| Plain text | LinkedIn, X, text messages, forms |

## Features

- Paste anywhere on the page (on a phone, tap the card); the result is auto-copied. Switching output re-copies the same paste.
- Detects the source (Google Docs, Notion, Word, Gmail, Airtable, Slack, PDF, Markdown, plain text) and lets you override how it's read.
- Headings, bold, italic, strikethrough, links, nested bullet and numbered lists, checkboxes, code, quotes and tables.
- Repairs text copied from PDFs (a page or the whole document): rejoins the hard line breaks into paragraphs, removes line-break hyphens (keeping real ones like "evidence-based"), drops page numbers and the headers and footers repeated on every page, tidies contents pages and fixes ligatures, drop caps and Word bullets. Copies from Preview also keep headings (worked out from font sizes) and any bold Preview marks. Chrome's PDF viewer copies plain text only, so its copies come through without headings.
- Fixes Google Docs quirks: the `<b style="font-weight:normal">` wrapper, formatting stored in inline styles, flattened nested lists, `google.com/url?q=` redirect links and "space after paragraph" spacing.
- No build step. Static HTML, CSS and JavaScript.

## Chrome extension

Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/paste-into/cafcglpffcdbmioicikgpiobcpfpkcge).

The same files are also a Chrome extension: `manifest.json` opens `index.html` as the toolbar popup. Click the Paste Into icon (or press Alt+Shift+V, which you can change at `chrome://extensions/shortcuts`), paste, and the result is copied.

To try it, open `chrome://extensions`, turn on Developer mode, choose Load unpacked and pick this folder.

To release a new version:

1. Check the version the Chrome Web Store shows as live. A rollback in the dashboard republishes an old package under a new, higher number, so the live version can be ahead of `manifest.json`.
2. Pick the next version (see below) and set `version` in `manifest.json`.
3. Run `npm run pack:extension`. It writes the Chrome Web Store upload to `dist/`.
4. Upload the zip to the Chrome Web Store.

### Version numbers

Versions are `MAJOR.MINOR.PATCH`, following [Semantic Versioning](https://semver.org/). Paste Into has no API, so each part is judged by what someone using it notices:

| Bump | When | Example |
|---|---|---|
| Patch, 1.1.0 → 1.1.1 | Something that should already have worked now works, or a small change people won't notice | Formatting kept when pasting from a Slack draft; a store description fix |
| Minor, 1.1.1 → 1.2.0 | Something new to do or see | A new output, input type (PDF reading), button or setting |
| Major, 1.2.0 → 2.0.0 | Something people rely on is removed or works differently, or the extension asks for a new permission | Dropping an output; a redesign; a permission that makes Chrome ask users again |

When unsure between patch and minor, choose patch. A bump resets the parts to its right to 0 (1.1.3 → 1.2.0).

Chrome's own rules ([manifest version](https://developer.chrome.com/docs/extensions/reference/manifest/version)): one to four whole numbers from 0 to 65535, no leading zeros, compared part by part as numbers, so 1.0.11 is higher than 1.0.4. The store rejects an upload whose version isn't higher than the live one, so a number can never be reused.

## Privacy

100% client-side. Nothing you paste leaves your browser.

On pasteinto.com and in the Chrome extension, `js/analytics.js` sends anonymous usage counts to [Umami Cloud](https://umami.is/) with no cookies: pageviews, plus events naming the detected source app, the output format and how you pasted (keyboard, tap or long-press). The Chrome extension sends the same counts, reported as the page `/extension`. It never sends pasted content.

## Run locally

```sh
git clone https://github.com/dewierwan/pasteinto
open pasteinto/index.html
```

## How it works

Every paste goes through the same three steps (`js/convert.js`):

1. **Read** it into HTML. Rich text is used as is, Markdown is parsed with the vendored [marked](https://github.com/markedjs/marked), and `js/from-pdf.js` rebuilds paragraphs and lists from PDF text. `js/from-slack.js` reads text copied from Slack's message box, which puts no HTML on the clipboard, only Slack's own formatting data. `js/sources.js` lists the apps a paste can come from, how to recognise each, and rewrites each app's quirks (Word's list paragraphs, Quill's flat lists) into plain HTML.
2. **Clean** it: `js/clean-html.js` reduces the HTML to a small, predictable subset. It knows nothing about any particular app.
3. **Write** the output from that: `js/to-markdown.js` writes Markdown, `js/to-text.js` writes WhatsApp and plain text, and the cleaned HTML itself is the Email & Slack and Docs output.

`js/app.js` wires up the page. Adding an input or an output means writing one function, not one per pair, and a fix for one app's quirk goes in one place.

## Roadmap

Ideas for later, roughly in order.

### Convert in place (Chrome extension)

Today every use is a round trip: copy, switch to Paste Into, paste, switch to the destination, paste. Instead, an extension shortcut (Alt+Shift+V) would convert whatever is on the clipboard for the site you're on, show a small "Ready for Gmail" note, and leave you to press ⌘V as usual. The site picks the output, the way the source is already detected:

| Site | Output |
|---|---|
| Gmail, Outlook, Slack, Teams | Email & Slack |
| Google Docs, Notion, Airtable | Docs |
| Claude, ChatGPT, GitHub | Markdown |
| WhatsApp Web | WhatsApp |
| LinkedIn, X | Plain text |
| Anything else | The last output used |

Notes: a Manifest V3 service worker can't use the clipboard, so this needs an offscreen document, plus the `clipboardRead` and `clipboardWrite` permissions and `activeTab` for the site's address. `clipboardRead` adds an install warning ("Read data you copy and paste") and a fresh store review. It would replace the parked "Clean Paste for Gmail" extension.

### Be found by people with the problem

The page title lists features, but people search for the problem, especially pasting a ChatGPT or Claude answer into Docs or Gmail and getting stray asterisks. Add a few pages that are the same tool with From and To preset and one plain heading, for example "ChatGPT to Google Docs", "Claude to Gmail", "Markdown to Slack", "Google Docs to Markdown" and "Fix line breaks in text copied from a PDF". Check search volumes first to pick the pages, write the Chrome Web Store listing around the same problem, and use the analytics to see which pages bring people in. Keep each page as minimal as the home page.

## Contributing

Real-world fixtures are the most useful contribution. Copy something in the app, run `npm run capture -- <folder>/<name>`, then run `npm run test:update` and check the expected outputs it writes. [`tests/fixtures/README.md`](tests/fixtures/README.md) has the details. For PDFs, add the copied text to `tests/fixtures/pdf/` (and the clipboard HTML, if the viewer wrote any) with a test in `tests/pdf.test.js`.

```sh
npm install
npm test
npm run lint:spell
npm run lint:html
```

## License

[MIT](LICENSE)

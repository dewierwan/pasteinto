# Fixtures

Each fixture is a paste, saved the way the browser received it.
`tests/fixtures.test.js` runs every fixture through detection and all five outputs and compares the results with the expected files next to it.

| File | What it is |
|---|---|
| `<name>.html` | The clipboard's HTML |
| `<name>.txt` | The clipboard's plain text (detection uses it) |
| `<name>.types` | The clipboard's types, one per line, when the app adds its own (Notion, Airtable) |
| `<name>.slack.json` | Slack's own clipboard data, in place of `<name>.html`, for a copy from Slack's message box (which has no HTML) |
| `<name>.detected.txt` | The detected source and how it is read |
| `<name>.expected.md` | Markdown output |
| `<name>.expected.email.html` | Email & Slack output |
| `<name>.expected.docs.html` | Docs output |
| `<name>.expected.whatsapp.txt` | WhatsApp output |
| `<name>.expected.plain.txt` | Plain text output |

PDF fixtures in `pdf/` are plain text instead: `<name>.txt`, plus `<name>-clipboard.html` when the viewer also wrote HTML. `tests/pdf.test.js` checks them in more detail.

## Adding a fixture

1. Copy something in the app you want to test.
2. Run `npm run capture -- <folder>/<name>` (macOS). It saves the clipboard, including the hidden types apps like Notion add, to `tests/fixtures/<folder>/`. Without a name, `npm run capture` opens a local page to paste into instead.
3. Run `npm run test:update`. It writes the expected files for the new fixture.
4. Read the expected files. If an output is wrong, fix the code, run `npm run test:update` again, and check the diff.

After any intended change to the output, `npm run test:update` rewrites the expected files; review the diff before committing. CI never writes them, so a fixture without its expected files fails there.

## Where the fixtures came from

Real captures are better than hand-written ones, because apps change their clipboard HTML without notice. Replace the hand-built ones with real captures when you can.

| Folder | Source |
|---|---|
| `gdocs/`, `airtable/` | Added with the original test suite |
| `pdf/` | Real viewer copies (see `tests/pdf.test.js`) |
| `notion/page`, `gmail/compose` | Real captures, 03 Oct 2026: a Notion page in Chrome, and text typed into Gmail's compose box |
| `gmail/reply` | Hand-built: a received email, with Gmail's `gmail_quote` markup |
| `airtable/sub-bullets` | Real capture, 09 Oct 2026: two sub-bullets copied from Airtable without their parent bullet, so the copy starts at `ql-indent-1`. The text is replaced with dummies |
| `slack/draft` | Real capture, 05 Oct 2026: a draft in Slack's message box in Chrome. The user and channel IDs and one link are replaced with dummies |
| `word/`, `vscode/`, `claude/` | Hand-built from each app's known clipboard format (October 2026), not yet real captures |

Real captures have already corrected four wrong assumptions: Notion writes to-dos as `[x]` text, not checkboxes; Gmail's compose box adds no `gmail_` classes, so text copied from it is read as ordinary rich text; Airtable adds no clipboard types of its own, so its pastes are read as ordinary rich text too (the shared Quill fix still turns its `<ul data-checked>` checklists into tasks); and Slack's message box copies no HTML at all, only plain text and its own `slack/texty` data.

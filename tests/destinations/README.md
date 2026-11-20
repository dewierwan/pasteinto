# Destination tests

The rest of the suite checks the HTML we write. These check what the apps people paste into make of it: whether a checklist becomes real to-dos in Notion, whether nested bullets survive Slack, and so on. Every bug found on 3 Oct 2026 was a case of HTML that looked right but that an app read differently.

## What runs in CI (`tests/destinations.test.js`)

1. **Pinned payloads.** The Docs and Email & Slack outputs of `sample.html` must equal the payloads in `verified.json`, which were pasted into the real apps. If an output changes, the test fails until someone re-checks the apps and updates the file.
2. **Airtable and Slack.** Both edit with Quill 1, which is open source, so the test runs Quill 1.3.7's own clipboard on the sample (it must match what the live apps produced) and on every fixture (no list item may change depth or merge with another).
3. **Rules from the live checks**, asserted on every fixture's output. For example, a Docs task item starts with a checkbox input and has no visible box, nested lists sit beside their parent item, and there is no ☑ anywhere. Each rule says which app it protects.

## What each app does with our outputs

| App | Output | Result |
|---|---|---|
| Notion | Docs | Real to-dos (ticked and nested), headings, bullets, numbers, quote |
| Airtable | Docs | Real checklist items (ticked and nested), headings, bullets, numbers, quote |
| Google Docs | Docs | Headings, bullets, numbers. Tasks get square bullets, and ticked looks like unticked |
| Slack | Email & Slack | Bold lines, nested bullets and numbers, ☐/☒ task lines, quote |
| Gmail | Email & Slack | The same as Slack |
| Word | Docs | Not checked |

Google Docs can't make a native checklist from pasted HTML. It reads checklists only from its own private clipboard data, which it ignores from other sources. Everything else was tried and is listed in `verified.json`. Selecting the square bullets and pressing ⌘⇧9 turns them into a checklist.

## Re-checking the apps

Do this when the destination test fails, or when an app changes how it pastes.

1. Run `npm run destinations:payloads` to print what each output puts on the clipboard for `sample.html`.
2. In each app, open the scratch page, paste the matching snippet from `live/` into the browser console, then call it with the payload:
   - **Notion** (`live/notion.js`): put the cursor in an empty text block, then run `await pasteintoNotion(payloads.rich)`. It prints the blocks Notion made.
   - **Airtable** (`live/quill.js`): click into a rich text field, then run `pasteintoQuill(payloads.rich['text/html'])`. Pass `true` as the second argument to also save it, then read the field back through the API, which returns Markdown with `[ ]` and `[x]`.
   - **Slack**: needs a real paste, because Slack decides what to do with a paste before its Quill clipboard runs. If a line of `text/plain` starts like Markdown (`1. `, `> `, `- `), Slack converts that text itself and ignores the HTML; if any `<ol>` has a `start` other than 1, it types every list number as text. `pasteintoQuill` (`live/quill.js`) skips both, so it only shows what Slack's Quill makes of the HTML. For the real thing, put the payload on the Mac clipboard (`public.html` and `public.utf8-plain-text`, or paste into the site and let it copy), click into the message box of a scratch channel and press ⌘V, then read `document.querySelector('.ql-container').__quill.getContents()`. Found 19 Nov 2026, when numbered lists lost their bold, links and nested bullets.
   - **Google Docs** (`live/google-docs.js`): put the cursor on an empty line, then run `pasteintoGoogleDocs(payloads.rich)`. Check the result by eye, or with the Docs API's `readDocument`.
   - **Gmail**: in a new message, dispatch the same paste event on `div[aria-label="Message Body"]` and read the body back. Close it without sending, and it stays in Drafts.
3. Compare the results with `observed` in `verified.json`. If they're right, paste the new payloads into `payloads` and update `observed` and `checked`.

The snippets fire a paste event carrying the payload. Notion, Google Docs and Gmail read pastes from that event, so this matches a real ⌘V. Airtable pastes through Quill's clipboard, which the Quill snippet calls directly. A real ⌘V into a Quill editor first goes through the browser's paste cleaning, and in Slack through its own paste handler, so Slack is checked with a real ⌘V. Dewi's own ⌘V into Notion matched the snippet's result.

Scratch places: the private Notion page "Paste Into paste test (scratch)" (made 19 Nov 2026), the Google Doc "2026-10-03: pasteinto paste test (scratch)" in AI docs, and the private Slack channel #dewi_scrap. The Airtable record used on 3 Oct 2026 no longer exists, so make a scratch record with a rich text field.

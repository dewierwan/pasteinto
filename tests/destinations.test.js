// Does each output become the right thing in the apps people paste into?
//
// Unit tests check the HTML we write; these check what apps make of it. Most
// apps are closed (Notion, Google Docs, Gmail), so the ground truth comes from
// pasting into the real apps (tests/destinations/README.md). This file keeps
// that truth from going stale, three ways:
//   1. The sample's outputs must equal the payloads last checked live
//      (verified.json). Change an output, and this fails until someone
//      re-checks the apps and updates the record.
//   2. Airtable and Slack edit with Quill 1, which is open source, so the real
//      Quill 1 clipboard runs here on every output, sample and fixtures alike.
//   3. Each rule the live checks taught us about Notion, Google Docs and Gmail
//      is asserted on every output, so new code can't quietly break one.
import { describe, it, expect } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { loadSite, fixture } from './load.js';

const w = loadSite();
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf-8');
const verified = JSON.parse(read('./destinations/verified.json'));
const sample = read('./destinations/sample.html');

function payload(html, output) {
  const result = w.convertClip({ html, text: '' }, 'rich', output);
  return { 'text/html': result.html, 'text/plain': result.text };
}

// Every real capture with HTML, plus the all-features sample.
const SOURCES = [
  ['sample', sample],
  ...readdirSync(new URL('./fixtures', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) =>
      readdirSync(new URL(`./fixtures/${dir.name}`, import.meta.url))
        .filter((file) => file.endsWith('.html') && !file.includes('.expected.'))
        .map((file) => [`${dir.name}/${file.replace(/\.html$/, '')}`, fixture(`${dir.name}/${file}`)]),
    ),
];

describe('outputs are the ones checked in real apps', () => {
  for (const output of ['rich', 'email']) {
    it(output === 'rich' ? 'Docs' : 'Email & Slack', () => {
      expect(
        payload(sample, output),
        'This output changed since it was pasted into the real apps. Re-check them (tests/destinations/README.md), then update verified.json.',
      ).toEqual(verified.payloads[output]);
    });
  }
});

// Quill 1.3.7, as Airtable's rich text fields and Slack's message box run it.
const quill = (() => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="editor"></div></body>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  dom.window.document.execCommand = () => false; // Quill calls it on load; jsdom has none
  dom.window.eval(readFileSync(createRequire(import.meta.url).resolve('quill/dist/quill.min.js'), 'utf-8'));
  return new dom.window.Quill(dom.window.document.getElementById('editor'));
})();

// The same outline as tests/destinations/live/quill.js prints in the real apps.
function quillOutline(html) {
  const lines = [];
  let line = '';
  for (const op of quill.clipboard.convert(html).ops) {
    const parts = String(op.insert).split('\n');
    const marks = op.attributes ? Object.keys(op.attributes).filter((k) => ['bold', 'italic', 'link'].includes(k)) : [];
    parts.forEach((part, i) => {
      if (part) line += marks.length ? `[${marks.join('+')}:${part}]` : part;
      if (i < parts.length - 1) {
        const a = op.attributes || {};
        const block = [a.header && `h${a.header}`, a.list, a.indent && `indent ${a.indent}`, a.blockquote && 'quote']
          .filter(Boolean)
          .join(', ');
        // A non-breaking space prints like a space; live outlines can't tell them apart.
        line = line.replace(/\u00A0/g, ' ');
        lines.push(block ? `${block} | ${line}` : line);
        line = '';
      }
    });
  }
  return lines;
}

describe('Airtable and Slack (their Quill 1 clipboard, run here)', () => {
  it('Docs output reads in Airtable as it did live', () => {
    expect(quillOutline(payload(sample, 'rich')['text/html'])).toEqual(verified.destinations.airtable.observed);
  });

  it('Email & Slack output reads in Slack as it did live', () => {
    expect(quillOutline(payload(sample, 'email')['text/html'])).toEqual(verified.destinations.slack.observed);
  });

  // Lines Quill says are list items, with their depth.
  const listLines = (lines) => lines.filter((l) => /^(bullet|ordered|checked|unchecked)\b/.test(l));

  for (const [name, html] of SOURCES) {
    it(`${name}: keeps every list item's depth and never merges items`, () => {
      for (const output of ['rich', 'email']) {
        const doc = new w.DOMParser().parseFromString(payload(html, output)['text/html'], 'text/html');
        const expected = [...doc.querySelectorAll('li')].map((li) => {
          const depth = Number((li.className.match(/ql-indent-(\d+)/) || [])[1] || 0);
          return { depth, text: li.textContent.replace(/\u00A0/g, ' ').trim() };
        });
        const got = listLines(quillOutline(payload(html, output)['text/html'])).map((l) => ({
          depth: Number((l.match(/indent (\d+)/) || [])[1] || 0),
          text: l
            .split(' | ')
            .slice(1)
            .join(' | ')
            .replace(/\[[a-z+]+:([^\]]*)\]/g, '$1')
            .trim(),
        }));
        expect(got, `${output} output`).toEqual(expected);
      }
    });
  }
});

// Slack's message box tests a paste's plain text for Markdown before it looks
// at the HTML, and on a match converts the text and drops the HTML. These are
// the line-start tests from hasAnyMarkdown in Slack's desktop app (19 Nov 2026).
// It also tests for Markdown inside a line (`code`, **bold**, [text](url)),
// which our text only has when the source had those characters typed out.
const SLACK_MARKDOWN_LINES = {
  'numbered list': /^1\. [^\s]/m,
  bullet: /^[-*] [^\s]/m,
  quote: /^> [^\s]/m,
  heading: /^#{1,6}\s+?\S/m,
  rule: /^---\s*$/m,
  'code fence': /^`{3,}\S+\s*$/m,
};

// Rules learned from pasting into Notion, Google Docs and Gmail (verified.json
// has the evidence). Checked on every source's output.
describe('rules for Notion, Google Docs, Gmail and Slack', () => {
  const parse = (html) => new w.DOMParser().parseFromString(html, 'text/html');
  const nestingIsBesideItems = (doc) =>
    [...doc.querySelectorAll('ul, ol')].every((list) => !list.parentElement.closest('li')) &&
    [...doc.querySelectorAll('li')].every((li) => {
      let depth = 0;
      for (let el = li.parentElement.parentElement; el && el.closest('ul, ol'); el = el.parentElement)
        if (/^(UL|OL)$/.test(el.tagName)) depth++;
      return li.className === (depth ? `ql-indent-${depth}` : '');
    });

  for (const [name, html] of SOURCES) {
    describe(name, () => {
      const docs = payload(html, 'rich');
      const email = payload(html, 'email');
      const docsDoc = parse(docs['text/html']);
      const emailDoc = parse(email['text/html']);

      it('Docs: every task starts with a checkbox input, with no visible box (Notion keeps it in the to-do)', () => {
        for (const li of docsDoc.querySelectorAll('ul[data-checked] > li')) {
          expect(li.firstChild.nodeName).toBe('INPUT');
        }
        expect(docs['text/html']).not.toMatch(/[☐☒☑]|<img/);
      });

      it('Docs: task lists are Airtable checklists with square bullets for Google Docs', () => {
        for (const list of docsDoc.querySelectorAll('ul[data-checked]')) {
          expect(list.getAttribute('style')).toContain('list-style-type:square');
          for (const li of list.children) {
            if (li.tagName === 'LI')
              expect(String(li.querySelector('input').hasAttribute('checked'))).toBe(list.getAttribute('data-checked'));
          }
        }
        expect(docsDoc.querySelectorAll('input[type="checkbox"]').length).toBe(docsDoc.querySelectorAll('ul[data-checked] > li').length);
      });

      it('Docs: text/plain has a line for each task (Notion pastes one-line text as inline text)', () => {
        const lines = docs['text/plain'].split('\n').map((l) => l.trim());
        for (const li of docsDoc.querySelectorAll('ul[data-checked] > li')) {
          const box = li.querySelector('input').hasAttribute('checked') ? '☒' : '☐';
          expect(lines).toContain(`${box} ${li.textContent.trim()}`);
        }
      });

      it('nested lists sit beside their parent item, marked with ql-indent (Slack, Airtable, Gmail)', () => {
        expect(nestingIsBesideItems(docsDoc)).toBe(true);
        expect(nestingIsBesideItems(emailDoc)).toBe(true);
      });

      it('Email & Slack: tasks are lines, not list items (Slack ignores list-style-type)', () => {
        for (const li of emailDoc.querySelectorAll('li')) expect(li.textContent.trim()).not.toMatch(/^[☐☒]/);
        expect(emailDoc.querySelectorAll('input').length).toBe(0);
      });

      it('the text beside the HTML has no line Slack reads as Markdown (Slack would then ignore the HTML)', () => {
        for (const output of [docs, email]) {
          for (const [rule, pattern] of Object.entries(SLACK_MARKDOWN_LINES)) {
            expect(output['text/plain'], `Slack rule: ${rule}`).not.toMatch(pattern);
          }
        }
      });

      it('no ☑ anywhere: Gmail swaps it for a coloured emoji', () => {
        for (const output of [docs, email, payload(html, 'plain'), payload(html, 'whatsapp')]) {
          expect(JSON.stringify(output)).not.toContain('☑');
        }
      });
    });
  }
});

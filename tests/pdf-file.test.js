// cspell:ignore pdfjs
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadSite } from './load.js';

// A PDF file, pasted or dropped, read with the pdf.js the site ships.
// tests/fixtures/pdf/links.pdf is links.source.html printed to PDF by Chrome.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = (file) => pathToFileURL(resolve(root, 'js/vendor/pdfjs', file)).href;

let w;
let clip;
beforeAll(async () => {
  w = loadSite();
  const pdfjs = await import(/* @vite-ignore */ vendor('pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdf.worker.min.mjs');
  clip = await w.readPdfData(pdfjs, new Uint8Array(readFileSync(resolve(root, 'tests/fixtures/pdf/links.pdf'))));
});

describe('a PDF file', () => {
  it('is read as PDF', () => {
    expect(w.detect(clip)).toEqual({ source: 'pdf', read: 'pdf' });
  });

  it('keeps its links, headings, bold and bullets in Markdown', () => {
    expect(w.convertClip(clip, 'pdf', 'markdown').text).toBe(
      [
        '# Fellowship update',
        'The spring cohort finished in May. The full result is in the [spring report](https://example.org/reports/spring), and the method is described in our [guide to measuring what happens to fellows after the program](https://example.org/handbook/how-we-measure-outcomes), which we revise each year.',
        '## What changed',
        '**Admissions.** We moved the deadline and rewrote the form. See [the result](https://example.org/apply?cohort=autumn&ref=update) for yourself.',
        '- Mentors now meet fellows every week instead of every month, which [fellows asked for](https://example.com/mentoring) in the last survey.\n- The capstone is required.',
        'Questions go to [team@example.org](mailto:team@example.org) or to the top of this page.',
      ].join('\n\n'),
    );
  });

  it('makes one link of a link that wraps onto a second line', () => {
    const wrapped = clip.pdf.links.filter((link) => link.href.endsWith('how-we-measure-outcomes'));
    expect(wrapped.length).toBeGreaterThan(1);
    expect(w.pdfToHtml(clip.text, '', clip.pdf).match(/how-we-measure-outcomes/g)).toHaveLength(1);
  });

  it('links the right "result", not the first one', () => {
    const html = w.pdfToHtml(clip.text, '', clip.pdf);
    expect(html).toContain('The full result is in the <a');
    expect(html).toContain('See <a href="https://example.org/apply?cohort=autumn&amp;ref=update">the result</a> for yourself.');
  });

  it('leaves out links to places inside the document', () => {
    expect(clip.pdf.links.map((link) => link.href).filter((href) => !/^(https:|mailto:)/.test(href))).toEqual([]);
    expect(w.pdfToHtml(clip.text, '', clip.pdf)).toContain('or to the top of this page.');
  });

  it('keeps the links in the rich text and plain outputs', () => {
    expect(w.convertClip(clip, 'pdf', 'rich').html).toContain('<a href="https://example.org/reports/spring">spring report</a>');
    expect(w.convertClip(clip, 'pdf', 'email').html).toContain('<a href="mailto:team@example.org">team@example.org</a>');
  });
});

// Text items the way pdf.js gives them: 6 points per character, 12 points a line.
describe('rebuilding a PDF file from its text items', () => {
  const item = (str, x, y, more = {}) => ({
    str,
    transform: [10, 0, 0, 10, x, y],
    width: str.length * 6,
    height: 10,
    hasEOL: false,
    ...more,
  });
  const line = (str, x, y, more) => [item(str, x, y, more), { ...item('', x, y), hasEOL: true }];
  const page = (items, links = []) => ({ items: items.flat(), links });

  it('ends a bullet at a line back out at the margin', () => {
    const made = w.pdfPagesToClip([
      page([
        line('● Led the admissions process for a competitive summer program, four', 36, 700),
        line('times, and coordinated the reviewers.', 48, 688),
        line('Example Consulting, Founder June 2022', 36, 676),
        line('● Helped students with their applications to college.', 36, 664),
      ]),
    ]);
    expect(made.text.split('\n')).toEqual([
      '● Led the admissions process for a competitive summer program, four',
      'times, and coordinated the reviewers.',
      '',
      'Example Consulting, Founder June 2022',
      '● Helped students with their applications to college.',
    ]);
  });

  it('starts a paragraph after a wider gap, but not at a new column', () => {
    const made = w.pdfPagesToClip([
      page([
        line('First line', 36, 700),
        line('second line', 36, 688),
        line('third line', 36, 676),
        line('New paragraph', 36, 652),
        line('Next column', 300, 700),
      ]),
    ]);
    expect(made.text.split('\n')).toEqual(['First line', 'second line', 'third line', '', 'New paragraph', 'Next column']);
  });

  it('finds the text under a link from its box when pdf.js gives none', () => {
    const made = w.pdfPagesToClip([
      page(
        [line('Read the annual report for the detail.', 36, 700)],
        // "annual report" starts 9 characters in: x from 36 + 54 to 36 + 132.
        [{ href: 'https://example.org/report', rect: [91, 697, 167, 710] }],
      ),
    ]);
    expect(made.pdf.links).toEqual([{ text: 'annual report', before: 'Read the ', href: 'https://example.org/report' }]);
  });

  it('reads bold from the font and leaves out text on its side', () => {
    const made = w.pdfPagesToClip([
      page([
        [item('Summary:', 36, 700, { bold: true }), item(' the cohort grew.', 84, 700), { ...item('', 36, 700), hasEOL: true }],
        [{ ...item('Downloaded from example.org', 20, 300), transform: [0, 10, -10, 0, 20, 300], hasEOL: true }],
      ]),
    ]);
    expect(made.text).toBe('Summary: the cohort grew.');
    expect(made.pdf.bold).toEqual(['Summary:']);
  });

  it('puts a link inside bold text without crossing the tags', () => {
    const text = 'Read the annual report today.';
    const file = {
      lines: [{ text, size: 10 }],
      bold: ['the annual report today'],
      links: [{ text: 'annual report', before: 'the ', href: 'https://example.org/' }],
    };
    expect(w.pdfToHtml(text, '', file)).toBe('<p>Read <b>the <a href="https://example.org/">annual report</a> today</b>.</p>');
  });
});

it('knows a PDF file by its type or name', () => {
  expect(w.isPdfFile({ type: 'application/pdf', name: 'resume' })).toBe(true);
  expect(w.isPdfFile({ type: '', name: 'Resume.PDF' })).toBe(true);
  expect(w.isPdfFile({ type: 'image/png', name: 'scan.png' })).toBe(false);
  expect(w.isPdfFile(null)).toBe(false);
});

import { describe, it, expect, beforeAll } from 'vitest';
import { loadSite } from './load.js';

let convertToMarkdown;
let stripImages;
let stripWrappingFence;
let unescapeOverEscaped;
let convertClip;
let cleanHtml;

beforeAll(() => {
  const window = loadSite();
  ({ convertToMarkdown, stripImages, stripWrappingFence, unescapeOverEscaped, convertClip, cleanHtml } = window);
  if (typeof convertToMarkdown !== 'function') throw new Error('convertToMarkdown not found — js/to-markdown.js may have failed to load.');
});

// The whole pipeline, as for a paste read as rich text with Markdown chosen.
const md = (html) => convertClip({ html, text: '' }, 'rich', 'markdown').text;
const cleanAndWrite = (html) => convertToMarkdown(cleanHtml(html, { target: 'markdown' }));

describe('headings', () => {
  it.each([
    ['<h1>X</h1>', '# X'],
    ['<h2>X</h2>', '## X'],
    ['<h3>X</h3>', '### X'],
    ['<h4>X</h4>', '#### X'],
    ['<h5>X</h5>', '##### X'],
    ['<h6>X</h6>', '###### X'],
  ])('%s → %s', (input, expected) => {
    expect(convertClip({ html: input, text: '' }, 'rich', 'markdown').text).toBe(expected);
  });
});

describe('quotes', () => {
  it('keeps a quote of several paragraphs as one quote', () => {
    expect(md('<blockquote><p>One</p><p>Two</p></blockquote>')).toBe('> One\n>\n> Two');
  });
});

describe('inline formatting', () => {
  it('bold via <strong>', () => {
    expect(md('<p><strong>hi</strong></p>')).toBe('**hi**');
  });
  it('italic via <em>', () => {
    expect(md('<p><em>hi</em></p>')).toBe('*hi*');
  });
  it('strikethrough via <s>, <strike>, <del>', () => {
    expect(md('<p><s>a</s></p>')).toBe('~~a~~');
    expect(md('<p><strike>a</strike></p>')).toBe('~~a~~');
    expect(md('<p><del>a</del></p>')).toBe('~~a~~');
  });
  it('inline code', () => {
    expect(md('<p><code>x</code></p>')).toBe('`x`');
  });
  it('mark/sub/sup pass through as HTML', () => {
    expect(md('<p><mark>hi</mark></p>')).toBe('<mark>hi</mark>');
    expect(md('<p>H<sub>2</sub>O</p>')).toBe('H<sub>2</sub>O');
    expect(md('<p>x<sup>2</sup></p>')).toBe('x<sup>2</sup>');
  });
});

describe('escape Markdown special characters in text', () => {
  it('escapes asterisks so "5 * 3" does not become italic', () => {
    expect(md('<p>5 * 3 = 15</p>')).toBe('5 \\* 3 = 15');
  });
  it('escapes underscores in identifiers', () => {
    expect(md('<p>John_Smith</p>')).toBe('John\\_Smith');
  });
  it('escapes brackets to prevent fake links', () => {
    expect(md('<p>[draft]</p>')).toBe('\\[draft\\]');
  });
  it('escapes backticks', () => {
    expect(md('<p>use `var` carefully</p>')).toBe('use \\`var\\` carefully');
  });
  it('does NOT escape inside <code>', () => {
    expect(md('<p><code>5 * 3</code></p>')).toBe('`5 * 3`');
  });
  it('does NOT escape inside <pre>', () => {
    expect(md('<pre>5 * 3 = 15</pre>')).toContain('5 * 3 = 15');
  });
});

// The writer on its own: the pipeline drops images from Markdown output.
describe('images', () => {
  it('basic img → ![alt](src)', () => {
    expect(convertToMarkdown('<img src="x.png" alt="cat">')).toBe('![cat](x.png)');
  });
  it('with title', () => {
    expect(convertToMarkdown('<img src="x.png" alt="cat" title="A cat">')).toBe('![cat](x.png "A cat")');
  });
  it('empty alt is allowed', () => {
    expect(convertToMarkdown('<img src="x.png">')).toBe('![](x.png)');
  });
  it('img with no src is dropped', () => {
    expect(convertToMarkdown('<img alt="orphan">')).toBe('');
  });
});

describe('horizontal rule', () => {
  it('hr → ---', () => {
    expect(md('<p>before</p><hr><p>after</p>')).toBe('before\n\n---\n\nafter');
  });
});

// Cleaner and writer only: the full pipeline unwraps a paste that is a single
// code block, since that is how browsers hand over pasted Markdown.
describe('code blocks', () => {
  it('plain pre → fenced code with no lang', () => {
    expect(cleanAndWrite('<pre>const x = 1;</pre>')).toBe('```\nconst x = 1;\n```');
  });
  it('pre with data-language → fenced with lang hint', () => {
    expect(cleanAndWrite('<pre data-language="js">const x = 1;</pre>')).toBe('```js\nconst x = 1;\n```');
  });
  it('pre wrapping <code class="language-py"> picks up python', () => {
    expect(cleanAndWrite('<pre><code class="language-py">x = 1</code></pre>')).toBe('```py\nx = 1\n```');
  });
});

describe('tables (GFM)', () => {
  it('simple table with thead', () => {
    const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
    expect(md(html)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });
  it('table without thead treats first row as header', () => {
    const html = '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>';
    expect(md(html)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });
  it('escapes pipes inside cells', () => {
    const html = '<table><tr><td>a|b</td><td>c</td></tr></table>';
    expect(md(html)).toContain('a\\|b');
  });
  it('preserves inline formatting in cells', () => {
    const html = '<table><tr><th>x</th></tr><tr><td><strong>bold</strong></td></tr></table>';
    expect(md(html)).toContain('| **bold** |');
  });
});

describe('whitespace cleanup', () => {
  it('collapses 3+ blank lines down to 2', () => {
    const html = '<div><p>a</p></div><div></div><div></div><div><p>b</p></div>';
    const out = md(html);
    expect(out).not.toMatch(/\n{3,}/);
  });
});

describe('lists', () => {
  it('unordered', () => {
    expect(md('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b');
  });
  it('ordered', () => {
    const out = md('<ol><li>a</li><li>b</li></ol>');
    expect(out).toContain('1. a');
    expect(out).toContain('2. b');
  });
  it('checkboxes', () => {
    const html = '<ul data-checked="true"><li>done</li></ul><ul data-checked="false"><li>todo</li></ul>';
    const out = md(html);
    expect(out).toContain('- [x] done');
    expect(out).toContain('- [ ] todo');
  });
});

describe('links', () => {
  it('basic link', () => {
    expect(md('<a href="https://x.com">x</a>')).toBe('[x](https://x.com)');
  });
});

describe('stripImages', () => {
  it('strips Google Docs base64 reference defs', () => {
    const input = 'before\n![][image1]\nafter\n\n[image1]: <data:image/png;base64,iVBORw0KGgo>';
    const out = stripImages(input);
    expect(out).not.toContain('data:image');
    expect(out).not.toContain('![');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('strips inline data: images with no leftover base64', () => {
    const out = stripImages('x ![alt](data:image/png;base64,XYZ123) y');
    expect(out).not.toContain('XYZ123');
    expect(out).not.toContain('data:image');
    expect(out).not.toContain('![');
  });

  it('strips reference-style images', () => {
    expect(stripImages('![alt][ref]')).not.toContain('![');
  });

  it('strips ordinary inline images too', () => {
    expect(stripImages('![logo](https://example.com/logo.png)')).not.toContain('![');
  });

  it('preserves ordinary inline links', () => {
    expect(stripImages('see [bluedot](https://bluedot.org)')).toBe('see [bluedot](https://bluedot.org)');
  });

  it('preserves ordinary reference links and their definitions', () => {
    const input = 'see [bluedot][1] for more\n\n[1]: https://bluedot.org';
    expect(stripImages(input)).toBe(input);
  });

  it('handles multiple images and defs', () => {
    const input = '![][image1]\n![][image2]\ntext\n\n[image1]: <data:image/png;base64,AAA>\n[image2]: <data:image/png;base64,BBB>';
    const out = stripImages(input);
    expect(out).not.toContain('data:');
    expect(out).not.toContain('![');
    expect(out).toContain('text');
  });
});

describe('stripWrappingFence', () => {
  it('strips the outer fence around pasted markdown', () => {
    const input = '```\n# Heading\n\nbody text\n```';
    expect(stripWrappingFence(input)).toBe('# Heading\n\nbody text');
  });

  it('strips an outer fence with a language hint', () => {
    const input = '```text\n# Heading\nbody\n```';
    expect(stripWrappingFence(input)).toBe('# Heading\nbody');
  });

  it('preserves real code blocks embedded mid-document', () => {
    const input = 'intro\n\n```js\nconst x = 1;\n```\n\noutro';
    expect(stripWrappingFence(input)).toBe(input);
  });

  it('preserves multiple consecutive code blocks (does not merge)', () => {
    const input = '```\nA\n```\n\n```\nB\n```';
    expect(stripWrappingFence(input)).toBe(input);
  });

  it('passes through markdown with no fences', () => {
    const input = '# Title\n\nparagraph';
    expect(stripWrappingFence(input)).toBe(input);
  });
});

describe('unescapeOverEscaped', () => {
  it('unescapes \\~ to ~', () => {
    expect(unescapeOverEscaped('\\~100 grants per year')).toBe('~100 grants per year');
  });

  it('unescapes \\. to .', () => {
    expect(unescapeOverEscaped('end of year 1\\. The next')).toBe('end of year 1. The next');
  });

  it('unescapes \\$, \\&, \\<, \\>', () => {
    expect(unescapeOverEscaped('\\$60k, M\\&E, \\<$10k, A \\> B')).toBe('$60k, M&E, <$10k, A > B');
  });

  it('preserves real markdown escapes', () => {
    expect(unescapeOverEscaped('a \\* b')).toBe('a \\* b');
    expect(unescapeOverEscaped('a \\[ b')).toBe('a \\[ b');
    expect(unescapeOverEscaped('a \\_ b')).toBe('a \\_ b');
  });

  it('preserves a literal escaped backslash followed by a special char', () => {
    expect(unescapeOverEscaped('a \\\\. b')).toBe('a \\\\. b');
    expect(unescapeOverEscaped('a \\\\~ b')).toBe('a \\\\~ b');
  });
});

// Browsers run event handlers in HTML set as innerHTML on an element of the live
// page, even one never shown (<img src=x onerror=...>). jsdom doesn't run them,
// so check the cause instead: pasted HTML must only be parsed with DOMParser.
describe('security', () => {
  it('never parses pasted HTML into the live page', () => {
    const window = loadSite();
    const setter = Object.getOwnPropertyDescriptor(window.Element.prototype, 'innerHTML').set;
    const live = [];
    Object.defineProperty(window.Element.prototype, 'innerHTML', {
      set(value) {
        if (this.ownerDocument === window.document) live.push(value);
        setter.call(this, value);
      },
    });
    const html = '<p>hi</p><img src="x" onerror="alert(1)">';
    for (const output of ['markdown', 'email', 'rich', 'whatsapp', 'plain']) window.convertClip({ html, text: '' }, 'rich', output);
    expect(live).toEqual([]);
  });
});

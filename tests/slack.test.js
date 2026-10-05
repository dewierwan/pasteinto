// Text copied from Slack's message box (js/from-slack.js). The whole paste is
// checked by the real capture in tests/fixtures/slack/; these cover the edges.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadSite } from './load.js';

let w;
beforeAll(() => {
  w = loadSite();
});

const delta = (...ops) => JSON.stringify({ ops });
const md = (...ops) => w.convertClip({ html: w.slackToHtml(delta(...ops)), text: '' }, 'rich', 'markdown').text;

describe('slackToHtml', () => {
  it('returns nothing for data that is not a Delta', () => {
    expect(w.slackToHtml('')).toBe('');
    expect(w.slackToHtml('not json')).toBe('');
    expect(w.slackToHtml('{"other":1}')).toBe('');
  });

  it('escapes text and links', () => {
    const html = w.slackToHtml(
      delta({ insert: '<img src=x onerror=alert(1)> & ' }, { insert: 'a', attributes: { link: 'https://x.com/?a="b"' } }),
    );
    expect(html).toBe('<div>&lt;img src=x onerror=alert(1)&gt; &amp; <a href="https://x.com/?a=&quot;b&quot;">a</a></div>');
  });

  it('keeps the last line when it has no line break', () => {
    expect(w.slackToHtml(delta({ insert: 'one\ntwo' }))).toBe('<div>one</div><div>two</div>');
  });

  it('keeps blank lines', () => {
    expect(w.slackToHtml(delta({ insert: 'one\n\ntwo\n' }))).toBe('<div>one</div><div><br></div><div>two</div>');
  });

  it('writes emoji as their code and skips other embeds', () => {
    expect(w.slackToHtml(delta({ insert: { slackemoji: { text: ':wave:' } } }, { insert: { image: 'x' } }, { insert: ' hi\n' }))).toBe(
      '<div>:wave: hi</div>',
    );
  });

  it('starts a new list after a line that is not in it', () => {
    expect(
      md(
        { insert: 'a' },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'gap\nb' },
        { insert: '\n', attributes: { list: 'bullet' } },
      ),
    ).toBe('- a\n\ngap\n\n- b');
  });

  it('drops links that are not web, email or phone links', () => {
    expect(md({ insert: 'x', attributes: { link: 'javascript:alert(1)' } })).toBe('x');
  });
});

describe('Slack detection', () => {
  it('names Slack when its clipboard type is present', () => {
    const clip = {
      html: w.slackToHtml(delta({ insert: 'hi', attributes: { bold: true } })),
      text: 'hi',
      types: ['text/plain', 'slack/texty'],
    };
    expect(w.detect(clip)).toEqual({ source: 'slack', read: 'rich' });
  });
});

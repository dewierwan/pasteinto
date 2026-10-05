// Reads text copied from Slack's message box. Slack puts no HTML on the
// clipboard there, only plain text and its own "slack/texty" type: a Quill
// Delta, a list of text runs with their formatting. (Sent messages copy as
// ordinary HTML.) Captured from a draft in Chrome, 05 Oct 2026:
//   {"ops":[{"attributes":{"bold":true},"insert":"Agenda"},
//           {"insert":"\nFirst topic"},{"attributes":{"list":"bullet"},"insert":"\n"},
//           {"insert":{"slackemoji":{"text":":wave:"}}}]}
// Formatting for a whole line (list, quote, code block) sits on the "\n" that
// ends it. A blank line is an empty line ("\n\n").
(function (root) {
  const SLACK_TYPE = 'slack/texty';

  // Returns the Delta as HTML that js/clean-html.js understands, or '' if it
  // isn't a Delta.
  function slackToHtml(json) {
    let ops;
    try {
      ops = JSON.parse(json).ops;
    } catch {
      return '';
    }
    if (!Array.isArray(ops)) return '';
    return linesToHtml(toLines(ops));
  }

  // Splits the runs into lines: { html, text, attrs } where attrs is the
  // line's own formatting.
  function toLines(ops) {
    const lines = [];
    let html = '';
    let text = '';
    for (const op of ops) {
      const attrs = op.attributes || {};
      if (typeof op.insert !== 'string') {
        // Emoji are objects ({ slackemoji: { text: ':wave:' } }). Keep their
        // code, which Slack turns back into the emoji.
        const code = (op.insert && op.insert.slackemoji && op.insert.slackemoji.text) || '';
        html += inline(code, attrs);
        text += code;
        continue;
      }
      const parts = op.insert.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) {
          lines.push({ html, text, attrs });
          html = '';
          text = '';
        }
        html += inline(part, attrs);
        text += part;
      });
    }
    if (html) lines.push({ html, text, attrs: {} });
    return lines;
  }

  // Mentions (@Dewi, #general) carry their name as text, so they need nothing.
  function inline(text, attrs) {
    if (!text) return '';
    let html = escapeHtml(text);
    if (attrs.code) html = `<code>${html}</code>`;
    if (attrs.strike) html = `<s>${html}</s>`;
    if (attrs.italic) html = `<em>${html}</em>`;
    if (attrs.bold) html = `<strong>${html}</strong>`;
    if (typeof attrs.link === 'string') html = `<a href="${escapeAttr(attrs.link)}">${html}</a>`;
    return html;
  }

  // Joins lines that share a block (a list, a quote, a code block). Lists are
  // written flat, with each item's level and type (see js/sources.js).
  function linesToHtml(lines) {
    const kind = (line) => (line.attrs.list ? 'list' : line.attrs.blockquote ? 'quote' : line.attrs['code-block'] ? 'code' : 'line');
    let out = '';
    for (let i = 0; i < lines.length;) {
      const k = kind(lines[i]);
      let end = i + 1;
      if (k !== 'line') while (end < lines.length && kind(lines[end]) === k) end++;
      const run = lines.slice(i, end);
      if (k === 'list') {
        const items = run.map((line) => {
          const level = (parseInt(line.attrs.indent, 10) || 0) + 1;
          const type = line.attrs.list === 'ordered' ? 'ol' : 'ul';
          return `<li aria-level="${level}" data-list-type="${type}">${line.html || '<br>'}</li>`;
        });
        out += `<ul>${items.join('')}</ul>`;
      } else if (k === 'quote') {
        out += `<blockquote>${run.map(div).join('')}</blockquote>`;
      } else if (k === 'code') {
        out += `<pre>${escapeHtml(run.map((line) => line.text).join('\n'))}</pre>`;
      } else {
        out += div(run[0]);
      }
      i = end;
    }
    return out;
  }

  function div(line) {
    return `<div>${line.html || '<br>'}</div>`;
  }

  root.SLACK_TYPE = SLACK_TYPE;
  root.slackToHtml = slackToHtml;
})(globalThis);

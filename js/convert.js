// Detects where a paste came from and converts it to the chosen output.
// Every paste goes through the same three steps:
//   1. read it into HTML (rich text as is, Markdown with marked, PDF text with
//      js/from-pdf.js) and rewrite its app's quirks (js/sources.js);
//   2. clean that HTML into a small, predictable subset (js/clean-html.js);
//   3. write the output from it (js/to-markdown.js, js/to-text.js, or the
//      cleaned HTML itself for Email & Slack and Docs).
// So adding an input or an output means writing one function, not one per pair.
(function (root) {
  const SOURCE_NAMES = {
    ...Object.fromEntries(APPS.map((app) => [app.id, app.name])),
    pdf: 'PDF',
    html: 'Rich text',
    markdown: 'Markdown',
    text: 'Plain text',
  };

  // clip: { html, text, types } from the paste event's clipboardData.
  /** @param {Clip} clip @returns {{ source: string, read: ReadAs }} */
  function detect(clip) {
    const html = clip.html || '';
    if (html) {
      const app = findApp(clip);
      if (app) return { source: app.id, read: 'rich' };
      // PDF viewers (Preview among them) also put HTML on the clipboard, with
      // one paragraph per printed line, so the plain text decides. Preview's
      // HTML for a page that isn't prose (contents, cover, slides) gives itself
      // away too, and reads better as PDF text than as a paragraph per line.
      // A real list or table never comes from a PDF viewer, which writes lines.
      // Without this, Airtable bullets in lowercase with no full stops ("book
      // the venue for the offsite") read as a PDF's wrapped lines.
      if (!hasListOrTable(html) && (isPdfText(clip.text) || isLineByLineHtml(html, clip.text))) return { source: 'pdf', read: 'pdf' };
      // Code editors (VS Code, GitHub) put coloured but unformatted HTML on the
      // clipboard. If the HTML has no real formatting and the text is Markdown, use that.
      if (!hasFormatting(html) && looksLikeMarkdown(clip.text)) return { source: 'markdown', read: 'markdown' };
      return { source: 'html', read: 'rich' };
    }
    if (isPdfText(clip.text)) return { source: 'pdf', read: 'pdf' };
    if (looksLikeMarkdown(clip.text)) return { source: 'markdown', read: 'markdown' };
    return { source: 'text', read: 'text' };
  }

  // PDF text can contain numbered lines and stray asterisks that look like
  // Markdown, so it wins unless the Markdown is unmistakable.
  function isPdfText(text) {
    return looksLikePdf(text) && !hasUnmistakableMarkdown(text);
  }

  // Apple's HTML writer (used by Preview's copy) with one <p> per line, nearly
  // all short. TextEdit and Mail write the same HTML, so it also needs a sign of
  // a printed page: more than one font size (a title or heading) or contents
  // leaders ("Introduction ______ 3").
  const LINE_HTML_MIN_LINES = 5;
  const LINE_HTML_MIN_P_SHARE = 0.8; // nearly every line is its own <p>
  const PRINTED_LINE_MAX_CHARS = 150; // a printed line is rarely longer
  const LONG_LINE_MAX_SHARE = 0.05; // allows the odd long line (a table row, a URL)
  const MIN_LEADERS = 3;
  function isLineByLineHtml(html, text) {
    if (!/Cocoa HTML Writer/.test(html)) return false;
    const lines = (text || '').split(/\r?\n/).filter((l) => l.trim());
    const paragraphs = (html.match(/<p[ >]/g) || []).length;
    if (lines.length < LINE_HTML_MIN_LINES || paragraphs < lines.length * LINE_HTML_MIN_P_SHARE) return false;
    if (lines.filter((l) => l.length > PRINTED_LINE_MAX_CHARS).length > lines.length * LONG_LINE_MAX_SHARE) return false;
    const sizes = new Set(html.match(/font: [\d.]+px/g) || []);
    const leaders = lines.filter((l) => /[_.·…]{4,}\s*\d{0,4}$/.test(l)).length;
    return sizes.size > 1 || leaders >= MIN_LEADERS;
  }

  function hasListOrTable(html) {
    return !!new DOMParser().parseFromString(html, 'text/html').querySelector('li, table');
  }

  function hasFormatting(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return !!doc.querySelector('b, strong, i, em, a[href], ul, ol, h1, h2, h3, h4, h5, h6, table, blockquote');
  }

  function hasStrongMarkdown(text) {
    return !!text && STRONG_MARKDOWN.some((re) => re.test(text));
  }

  // Stricter than STRONG_MARKDOWN: bold markers hug words ("**this**", not
  // "31.1** 31.2**" footnote marks), and headings have a blank line after them,
  // which PDF text never does.
  function hasUnmistakableMarkdown(text) {
    return [
      /(^|[\s(])\*\*[^*\s][^*\n]*[^*\s]\*\*(?=[\s.,;:!?)]|$)/m,
      /^#{1,6}\s+\S[^\n]*\n[ \t]*\n/m,
      /\[[^\]\n]+\]\(https?:[^)\s]+\)/,
      /^```/m,
    ].some((re) => re.test(text));
  }

  function looksLikeMarkdown(text) {
    if (!text) return false;
    if (hasStrongMarkdown(text)) return true;
    const listLines = text.match(/^\s*([-*+]|\d+[.)])\s+\S/gm) || [];
    return listLines.length >= 2;
  }

  const STRONG_MARKDOWN = [
    /^#{1,6}\s+\S/m, // heading
    /\*\*[^*\n]+\*\*/, // bold
    /\[[^\]\n]+\]\([^)\s]+\)/, // link
    /^```/m, // code fence
    /^\s*[-*]\s+\[[ xX]\]\s/m, // task list
  ];

  // readAs: 'rich' | 'markdown' | 'text' | 'pdf'.
  // output: 'markdown' | 'email' | 'rich' | 'whatsapp' | 'plain'.
  // Returns { text, html } where html is set only for rich output.
  function convertClip(clip, readAs, output) {
    // Markdown and plain text are already Markdown.
    if (output === 'markdown' && (readAs === 'markdown' || readAs === 'text')) {
      return { text: (clip.text || '').replace(/\r\n/g, '\n').trim() };
    }

    const { html, spacing } = readHtml(clip, readAs);
    if (output === 'markdown') {
      const markdown = convertToMarkdown(cleanHtml(html, { target: 'markdown', spacing }));
      return { text: unescapeOverEscaped(stripImages(stripWrappingFence(markdown))) };
    }

    // Email markup (headings as bold lines) also feeds the text writers.
    const email = cleanHtml(html, { target: 'rich', headings: 'bold', spacing });
    const plain = toText(email, 'plain');
    if (output === 'email') return { html: email, text: plain };
    // Docs keeps real checkboxes: Notion turns them into to-dos.
    if (output === 'rich') return { html: cleanHtml(html, { target: 'rich', headings: 'keep', tasks: 'inputs', spacing }), text: plain };
    return { text: output === 'plain' ? plain : toText(email, output) };
  }

  // Step 1: the paste as HTML, with its app's quirks rewritten, and how that
  // app marks blank lines (see js/sources.js).
  /** @param {Clip} clip @param {ReadAs} readAs @returns {{ html: string, spacing: Spacing }} */
  function readHtml(clip, readAs) {
    // breaks: a single newline is a line break ("Thanks,⏎Dewi"), as in chat apps.
    if (readAs === 'markdown') return { html: marked.parse(clip.text || '', { gfm: true, breaks: true }), spacing: 'tags' };
    if (readAs === 'pdf') return { html: pdfToHtml(clip.text, clip.html), spacing: 'tags' };
    if (readAs !== 'rich' || !clip.html) return { html: textToHtml(clip.text), spacing: 'tags' };
    const app = findApp(clip);
    return { html: fixHtml(clip.html, app), spacing: (app && app.spacing) || 'tags' };
  }

  function textToHtml(text) {
    return (text || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => (line ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>'))
      .join('');
  }

  root.SOURCE_NAMES = SOURCE_NAMES;
  root.detect = detect;
  root.looksLikeMarkdown = looksLikeMarkdown;
  root.convertClip = convertClip;
})(globalThis);

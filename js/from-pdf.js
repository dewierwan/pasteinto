// cspell:ignore lowship Ministère activité Rapport GORSUCH KAGAN capitalised
// Repairs text copied from a PDF viewer. PDFs store positioned lines, not
// paragraphs, so a copy has a hard break at the end of every line, words split
// by hyphens, ligature characters and page numbers, and (in Preview and Chrome)
// no blank lines between paragraphs. This rebuilds paragraphs and lists from
// the plain text. Preview also puts HTML on the clipboard with each line's font
// size (and sometimes bold), which gives back headings and bold. A PDF file
// read by js/from-pdf-file.js gives the same, and its links too.
(function (root) {
  const LIGATURES = { ﬀ: 'ff', ﬁ: 'fi', ﬂ: 'fl', ﬃ: 'ffi', ﬄ: 'ffl', ﬅ: 'st', ﬆ: 'st' };
  // PDF viewers mark line-end hyphens in different ways: Chrome (PDFium) writes
  // U+FFFE, Chrome-made PDFs use U+2010, Word and LaTeX a plain "-".
  const HYPHEN = '[-\u2010\uFFFE]';
  // Word's Symbol and Wingdings bullets come through as private-use characters.
  const BULLET = /^\s*[•●▪■◦○‣∙·*–—\-\uF0A7\uF0B7\uF076\uF0D8\uF0FC]\s+/;
  const NUMBER = /^((\d{1,2}|[a-z]|[ivx]{1,4})[.)]|\((\d{1,2}|[a-z]|[ivx]{1,4})\))\s+/i;
  const NUMBERED_HEADING = /^\d{1,2}(\.\d+)*\.?\s+\p{Lu}\S*(\s+\S+){0,4}$/u; // "3. Code sample", "1.1 Scope"
  const LABEL = /^\p{Lu}\p{L}*( \(?\p{Lu}[\p{L})]*){0,3}: /u; // "Program Results: ", "Perigee (Miles): "
  const LEADER = /\s*[_.·…]{4,}\s*(\d{1,4})?$/;
  const LEADER_ONLY = /^\s*[_.·…]{4,}\s*\d{0,4}$/;
  const TOC_END = '\u0000'; // marks a contents entry while lines are joined
  // A line ending like this carries on onto the next ("Standard and" / "Filing").
  const CONTINUES = /(\b(and|or|of|the|a|an|for|to|in|on|with|from|by|at)|[,:–—-])$/i;
  const DROP_CAP = /^\p{Lu}$/u; // a large first letter on a line of its own
  const PAGE_NUMBER = /^(page\s+)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;
  // Line lengths as a share of the column width. A line that wrapped runs
  // close to the edge; one that stops well short ended its paragraph.
  const SHORT_LINE = 0.8; // under this, a line stopped early instead of wrapping
  const FULL_LINE = 0.9; // a wrapped line, plus the next line's first word, passes this
  const RUN_ON_LINE = 0.3; // a sentence carrying on in lowercase joins unless its line is under this (a list item)
  const HEADING_LINE = 0.7; // a heading after a paragraph is shorter than this
  const WIDE_LINE = 1.2; // a line wider than this spans two columns (a title)
  const LIST_WIDTH = 25; // characters: a paste whose lines are nearly all shorter is a list, not a wrapped column
  // Preview's font sizes: a heading is clearly bigger than the body text, and short.
  const HEADING_SIZE = 1.15;
  const HEADING_MAX_CHARS = 100;
  const HEADING_MAX_WORDS = 12;
  // Words often joined to the next with a real hyphen ("self-attention").
  // Common second halves of hyphenated compounds ("evidence-based").
  // prettier-ignore
  const COMPOUND_SUFFIXES = new Set(['based', 'wise', 'like', 'free', 'level', 'scale', 'specific', 'related', 'driven', 'aware', 'oriented', 'wide', 'term', 'range', 'making', 'friendly', 'owned', 'led', 'up', 'out', 'off', 'in', 'on', 'down', 'time']);
  // prettier-ignore
  const COMPOUND_PREFIXES = new Set(['self', 'non', 'multi', 'well', 'mid', 'cross', 'half', 'semi', 'anti', 'ex', 'state', 'follow', 'long', 'short', 'high', 'low', 'full', 'part']);

  // html: the clipboard's HTML, if any; only Preview's (Cocoa HTML Writer) is used.
  // file: what a PDF file itself says about its text (js/from-pdf-file.js),
  // used in place of the HTML.
  /** @param {string} text @param {string} [html] @param {PdfFormatting} [file] */
  function pdfToHtml(text, html, file) {
    const lines = normalise(text);
    const format = file ? fileFormatting(file) : readFormatting(html);
    const width = typicalWidth(lines);
    const local = localWidths(lines, width);
    const words = wordCounts(lines);
    const blocks = [];
    let block = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {
        block = null;
        continue;
      }
      // A heading line starts its own block; a heading over two lines stays one.
      const level = !line.includes(TOC_END) && format.headings.get(lineKey(line));
      if (level) {
        // A title (level 1) over two lines is one heading. Lower headings often sit
        // together (on a contents page), so a line joins only if it carries on the
        // one above ("Standard Deduction, and" / "Filing Information").
        const carriesOn =
          block &&
          block.type === 'h' &&
          block.level === level &&
          (level === 1 || CONTINUES.test(block.lines[block.lines.length - 1]) || /^\p{Ll}/u.test(line));
        if (carriesOn) block.lines.push(line);
        else blocks.push((block = { type: 'h', level, lines: [line], wraps: false }));
        continue;
      }
      if (block && block.type === 'h') block = null;
      const marker = listMarker(line);
      if (!block || marker) {
        block = { type: marker ? marker.type : 'p', lines: [marker ? line.slice(marker.length) : line], wraps: false };
        blocks.push(block);
      } else if (joins(lines[i - 1], line, lines[i + 1], local[i - 1], width)) {
        // Short lines followed by a wrapped paragraph: the paragraph is separate
        // ("Other Situations" above "You may have to file…").
        if (!block.wraps && block.lines.length > 1 && !isShort(lines[i - 1], local[i - 1])) {
          block = { type: 'p', lines: [block.lines.pop()], wraps: false };
          blocks.push(block);
        }
        block.lines[block.lines.length - 1] = joinLines(block.lines[block.lines.length - 1], line, words);
        block.wraps = true;
      } else if (
        !block.wraps &&
        block.type === 'p' &&
        ((isShort(lines[i - 1], width) && isShort(line, width)) || line.includes(TOC_END) || width < LIST_WIDTH)
      ) {
        // Runs of short lines (addresses, sign-offs, code, contents) stay as separate lines.
        block.lines.push(line);
      } else {
        block = { type: 'p', lines: [line], wraps: false };
        blocks.push(block);
      }
    }
    return render(blocks, format);
  }

  // Compares a text line with an HTML line despite ligatures and spacing.
  function lineKey(line) {
    return line
      .replace(TOC_END, '')
      .replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/g, (c) => LIGATURES[c])
      .replace(/[\s\u00AD\uFFFE]+/g, ' ')
      .trim();
  }

  // From Preview's HTML (one <p> per printed line, font sizes in a stylesheet):
  // headings, as a map from line text to level 1–3, and the bold runs in order
  // (Preview copies no links).
  // Lines in a font clearly larger than the body text, short and worded like a
  // heading, are headings; the sizes rank into levels. Other HTML gives nothing.
  function readFormatting(html) {
    const none = { headings: new Map(), bold: [], links: [] };
    if (!html || !/Cocoa HTML Writer/.test(html)) return none;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sizes = {};
    for (const [, tag, cls, rule] of (doc.querySelector('style')?.textContent || '').matchAll(/(p|span)\.(\w+)\s*\{([^}]*)\}/g)) {
      const size = rule.match(/font:[^;]*?([\d.]+)px/);
      if (size) sizes[`${tag}.${cls}`] = parseFloat(size[1]);
    }
    const lines = [];
    for (const p of doc.querySelectorAll('p')) {
      const text = lineKey(p.textContent);
      if (!text) continue;
      // The size most of the line is in (a footnote mark is a smaller span).
      const bySize = new Map();
      for (const node of p.childNodes) {
        const cls = node.nodeType === 1 && /** @type {Element} */ (node).className;
        const own = cls && sizes[`span.${cls}`];
        const size = own || sizes[`p.${p.className}`] || 0;
        bySize.set(size, (bySize.get(size) || 0) + node.textContent.length);
      }
      const size = [...bySize].sort((a, b) => b[1] - a[1])[0][0];
      lines.push({ text, size });
    }
    if (!lines.length) return none;
    const bold = Array.from(doc.querySelectorAll('b'), (b) => ({ text: boldKey(b.textContent) })).filter((run) => run.text.length > 1);
    return { headings: rankHeadings(lines), bold, links: [] };
  }

  // The same from a PDF file: each printed line's font size, and the bold and
  // linked runs in reading order.
  /** @param {PdfFormatting} file */
  function fileFormatting(file) {
    const lines = file.lines.map((l) => ({ text: lineKey(l.text), size: l.size })).filter((l) => l.text);
    const bold = file.bold.map((text) => ({ text: boldKey(text) })).filter((run) => run.text.length > 1);
    const links = file.links
      .map((link) => ({
        text: lineKey(link.text),
        before: (link.before || '').replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/g, (c) => LIGATURES[c]),
        href: link.href,
      }))
      .filter((run) => run.text);
    return { headings: rankHeadings(lines), bold, links };
  }

  // A bold run as it will appear in the rebuilt text: a hyphen at a line's end goes when the lines join.
  function boldKey(text) {
    return lineKey(text).replace(new RegExp(`${HYPHEN}$`), '');
  }

  // lines: each printed line's text and font size. Returns the headings, as a
  // map from line text to level 1–3.
  function rankHeadings(lines) {
    const chars = new Map();
    for (const l of lines) chars.set(l.size, (chars.get(l.size) || 0) + l.text.length);
    const body = [...chars].sort((a, b) => b[1] - a[1])[0][0];
    const big = (l) =>
      l &&
      l.size >= body * HEADING_SIZE &&
      /\p{L}/u.test(l.text) &&
      l.text.length <= HEADING_MAX_CHARS &&
      l.text.split(/\s+/).length <= HEADING_MAX_WORDS &&
      !/[.;]$/.test(l.text) &&
      !LEADER.test(l.text);
    // A heading starts with a capital or digit, unless it carries on the heading
    // above; one that stops on "to" or "and" needs a heading line after it.
    const isHeading = (l, i) =>
      big(l) &&
      (/^[\p{Lu}\d"“‘(]/u.test(l.text) || (big(lines[i - 1]) && lines[i - 1].size === l.size)) &&
      (!CONTINUES.test(l.text) || (big(lines[i + 1]) && lines[i + 1].size === l.size));
    const marked = lines.filter(isHeading);
    const levels = [...new Set(marked.map((l) => l.size))].sort((a, b) => b - a);
    const headings = new Map();
    for (const l of marked) headings.set(l.text, Math.min(levels.indexOf(l.size) + 1, 3));
    return headings;
  }

  function normalise(text) {
    const lines = (text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/g, (c) => LIGATURES[c])
      .replace(/\u00A0/g, ' ')
      // Some fonts (LaTeX's among them) map the hyphen glyph to a soft hyphen,
      // which most apps hide. Inside a line it is a real hyphen, or a dash between spaces.
      .replace(/ \u00AD /g, ' – ')
      .replace(/(\S)\u00AD(?=\S)/g, '$1-')
      // PDFium sometimes joins a hyphenated line itself and leaves U+FFFE inside it.
      .replace(/(\S)\uFFFE(\S)/g, '$1\uFFFE\n$2')
      .split('\n')
      .map((l) => l.replace(/\s+$/, '').replace(/\u00AD$/, '\u2010'))
      .filter((l) => !PAGE_NUMBER.test(l.trim()))
      // A contents entry ends in a leader ("Introduction ______ 3"): keep it as
      // its own line, with the page number but without the leader. A leader
      // that wrapped onto a line of its own belongs to the entry above.
      .reduce((out, l) => {
        if (LEADER_ONLY.test(l)) {
          if (out.length && !out[out.length - 1].includes(TOC_END)) out[out.length - 1] += TOC_END;
        } else {
          out.push(l.replace(LEADER, (m, page) => `${TOC_END}${page ? ` ${page}` : ''}`));
        }
        return out;
      }, []);
    return dropRunningHeaders(lines);
  }

  // A copy of several pages repeats each page's header and footer ("Cite as:
  // 603 U. S. (2024)", "Annual Report | 18"). Drop lines that recur, with their
  // numbers ignored, from start to end of the paste, so paragraphs can run on
  // across page breaks. Lines ending like a sentence or a label never count, and
  // a line must recur every few pages and span half the paste, unlike a table
  // row or a "Line 1" heading.
  function dropRunningHeaders(lines) {
    const key = (l) => l.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ');
    const hyphenEnd = new RegExp(`${HYPHEN}$`);
    const seen = new Map();
    lines.forEach((l, i) => {
      if (!l.trim() || l.length > 100 || /[.!?;,:]$/.test(l) || hyphenEnd.test(l)) return;
      if (hyphenEnd.test(lines[i - 1] || '')) return;
      const k = key(l);
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push(i);
    });
    // Headers often alternate between left and right pages, so each version
    // appears on only half of them.
    const minCount = Math.max(3, lines.length / 400);
    // A section's own running head ("Syllabus", "KAGAN, J., dissenting") may
    // cover only part of the paste, but it gives itself away by landing in the
    // middle of sentences: a short, capitalised line after a full line that stops
    // mid-sentence, before one that carries on in lowercase. Page headers found
    // first are looked past, since section heads often sit under them.
    const lengths = lines
      .filter(Boolean)
      .map((l) => l.length)
      .sort((a, b) => a - b);
    const typical = lengths[Math.floor(lengths.length / 2)] || 0;
    const candidates = new Set();
    for (const [k, at] of seen) {
      const span = at[at.length - 1] - at[0];
      if (at.length >= minCount && span >= lines.length / 2 && span / (at.length - 1) >= 15) candidates.add(k);
    }
    const textAround = (i, step) => {
      let j = i + step;
      while (j >= 0 && j < lines.length && (!lines[j].trim() || candidates.has(key(lines[j])))) j += step;
      return lines[j] || '';
    };
    const interrupts = (i) => {
      const before = textAround(i, -1);
      return (
        lines[i].length < typical * 0.6 &&
        /^[\p{Lu}0-9]/u.test(lines[i]) &&
        before.length >= typical &&
        /[\p{Ll},]$/u.test(before) &&
        /^\p{Ll}/u.test(textAround(i, 1))
      );
    };
    for (const [k, at] of seen) {
      if (!candidates.has(k) && at.length >= 3 && at.filter(interrupts).length >= 2) candidates.add(k);
    }

    // Repeated wording (the same example twice) is followed by the same line
    // nearly every time; a footer is followed by the page's own text. Headers
    // come in pairs ("Rapport d'activité 2024" above "Ministère …"), so look past
    // other candidates first.
    const running = new Set();
    for (const k of candidates) {
      const after = new Map();
      for (const i of seen.get(k)) {
        let j = i + 1;
        while (j < lines.length && (!lines[j].trim() || candidates.has(key(lines[j])))) j++;
        const next = key(lines[j] || '');
        after.set(next, (after.get(next) || 0) + 1);
      }
      if (Math.max(...after.values()) < seen.get(k).length * 0.8) running.add(k);
    }
    return running.size ? lines.filter((l) => !running.has(key(l))) : lines;
  }

  // The column width in characters: the longer of the lines that clearly wrap
  // (the next line starts in lowercase), or of all lines when too few do.
  function typicalWidth(lines) {
    const wrapped = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      if (lines[i] && /^\p{Ll}/u.test(lines[i + 1])) wrapped.push(lines[i].length);
    }
    const sample = wrapped.length >= 3 ? wrapped : lines.filter(Boolean).map((l) => l.length);
    sample.sort((a, b) => a - b);
    return sample[Math.floor(sample.length * 0.9)] || 0;
  }

  // Pages can mix widths (a full-width table above two columns), so judge each
  // line against nearby lines that provably wrapped (the next line carries on in
  // lowercase). With none nearby, as in an address, use the page's width.
  function localWidths(lines, width) {
    const wrapped = lines.map((l, i) => (l && /^\p{Ll}/u.test(lines[i + 1] || '') ? l.length : 0));
    return lines.map((_, i) => {
      // The median, so one wide table row nearby doesn't count.
      const near = wrapped
        .slice(Math.max(0, i - 5), i + 6)
        .filter(Boolean)
        .sort((a, b) => a - b);
      return near.length ? Math.min(near[Math.floor(near.length / 2)], width) : width;
    });
  }

  function isShort(line, width) {
    return line.length < width * SHORT_LINE;
  }

  // How full the line would be with the next line's first word added. A line
  // only wrapped if that word would not have fitted on it.
  function fill(prev, line, width) {
    return (prev.length + 1 + line.trimStart().split(/\s/)[0].length) / width;
  }

  // width: the column width near this line; pageWidth: across the whole paste.
  function joins(prev, line, next, width, pageWidth) {
    if (!prev || /[{};]$/.test(prev) || prev.includes(TOC_END) || line.includes(TOC_END)) return false; // code and contents keep their lines
    if (new RegExp(`${HYPHEN}$`).test(prev) && /^\p{Ll}/u.test(line)) return true;
    if (DROP_CAP.test(prev) && /^\p{Ll}/u.test(line)) return true;
    if (DROP_CAP.test(line)) return false; // a drop cap starts a paragraph
    if (pageWidth < LIST_WIDTH) return false;
    const full = fill(prev, line, width);
    // A sentence carrying on in lowercase, unless the line is short (a list
    // item, or a numbered heading like "3. Code sample").
    if (/^[\p{Ll}(]/u.test(line) && !/[.!?:]$/.test(prev)) return full >= RUN_ON_LINE && !NUMBERED_HEADING.test(prev);
    // A label starts its own line in forms and notes ("Program Results: …").
    if (LABEL.test(line)) return false;
    // Lines wider than the column (titles over two columns) stand alone.
    if (full < FULL_LINE || prev.length > pageWidth * WIDE_LINE) return false;
    // A full line followed by a short, unpunctuated line that doesn't run on is a
    // paragraph ending before a heading ("1.1 Scope").
    const heading = line.length < width * HEADING_LINE && /^[\p{Lu}0-9]/u.test(line) && !/[.!?:;,]$/.test(line);
    if (heading && !(next && /^\p{Ll}/u.test(next))) return false;
    return true;
  }

  function joinLines(prev, line, words) {
    if (DROP_CAP.test(prev)) return prev + line.trimStart(); // "E" + "n 2023" → "En 2023"
    const match = prev.match(new RegExp(`(\\S*?)${HYPHEN}$`));
    if (!match || !/^\p{L}/u.test(line)) return `${prev} ${line.trimStart()}`;
    const left = match[1];
    const right = line.match(/^\S+/)[0];
    const keep = keepHyphen(left, right, words);
    return prev.slice(0, -1) + (keep ? '-' : '') + line.trimStart();
  }

  // Decides whether a line-end hyphen is part of the word ("English-to-German")
  // or was added to break it across lines ("fel-lowship").
  function keepHyphen(left, right, words) {
    const l = left.replace(/^[^\p{L}]+/u, '').toLowerCase();
    const r = right.replace(/[^\p{L}]+$/u, '').toLowerCase();
    // Part of a chain ("ever-more-capable") or before a capital ("non-English").
    if (/-/.test(left + right) || /^[\p{Lu}0-9]/u.test(right)) return true;
    if (words.joined.has(l + r)) return false;
    if (words.hyphenated.has(`${l}-${r}`)) return true;
    if (COMPOUND_SUFFIXES.has(r) || (COMPOUND_PREFIXES.has(l) && words.joined.has(r))) return true;
    // Both halves are words in their own right elsewhere ("sequence", "aligned").
    return l.length > 2 && r.length > 2 && words.joined.has(l) && words.joined.has(r);
  }

  // Words seen elsewhere in the paste, joined and hyphenated, to settle hyphens.
  // The halves of words split at line ends don't count.
  function wordCounts(lines) {
    const joined = new Set();
    const hyphenated = new Set();
    const splitEnd = new RegExp(`\\S+${HYPHEN}$`);
    lines.forEach((line, i) => {
      let text = line.replace(splitEnd, '');
      if (i > 0 && splitEnd.test(lines[i - 1])) text = text.replace(/^\s*\S+/, '');
      for (const word of text.toLowerCase().match(/\p{L}+(-\p{L}+)*/gu) || []) {
        if (word.includes('-')) hyphenated.add(word);
        else joined.add(word);
      }
    });
    return { joined, hyphenated };
  }

  function listMarker(line) {
    const bullet = line.match(BULLET);
    if (bullet) return { type: 'ul', length: bullet[0].length };
    const number = line.match(NUMBER);
    // "1. Introduction" style headings look like list items too; a list item
    // must have more than a couple of words.
    if (number && line.slice(number[0].length).split(/\s+/).length > 3) return { type: 'ol', length: 0 };
    return null;
  }

  function render(blocks, format) {
    for (const block of blocks) block.lines = block.lines.map((l) => l.replace(TOC_END, ''));
    const bold = locate(blocks, format.bold).map((at) => ({ ...at, open: '<b>', close: '</b>' }));
    const links = joinLinks(blocks, locate(blocks, format.links)).map((at) => ({
      ...at,
      open: `<a href="${escapeAttr(at.run.href)}">`,
      close: '</a>',
    }));
    // A block's lines as HTML. A heading is bold already, so it keeps only its links.
    const marked = (block) => {
      const runs = (block.type === 'h' ? links : [...bold, ...links]).filter((at) => at.block === block);
      return block.lines.map((line, i) =>
        markUp(
          line,
          runs.filter((at) => at.line === i),
        ),
      );
    };
    let html = '';
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.type === 'h') {
        html += `<h${block.level}>${marked(block).join(' ')}</h${block.level}>`;
        continue;
      }
      if (block.type === 'p') {
        html += `<p>${marked(block).join('<br>')}</p>`;
        continue;
      }
      // Group consecutive items of the same kind into one list. Numbered items
      // keep their own numbers as text, since lists in PDFs often skip or restart.
      const tag = block.type;
      let items = '';
      while (i < blocks.length && blocks[i].type === tag) items += `<li>${marked(blocks[i++]).join(' ')}</li>`;
      i--;
      html += tag === 'ul' ? `<ul>${items}</ul>` : items.replace(/<\/?li>/g, (t) => (t === '<li>' ? '<p>' : '</p>'));
    }
    return html;
  }

  // Finds each run (bold or linked text, in document order) where it next
  // appears in the rebuilt blocks. A run that isn't there (its line was dropped
  // as a page header, or joined differently) is skipped. So is one whose only
  // match lies beyond the next run's: that match is some later use of the same
  // words, and taking it would leave every run in between unplaced.
  function locate(blocks, runs) {
    const found = [];
    let from = { block: 0, line: 0, at: 0 };
    const next = (run) => {
      for (let b = from.block; b < blocks.length; b++) {
        const lines = blocks[b].lines;
        for (let li = b === from.block ? from.line : 0; li < lines.length; li++) {
          const at = indexOfRun(lines[li], run, b === from.block && li === from.line ? from.at : 0);
          if (at >= 0) return { block: b, line: li, at };
        }
      }
      return null;
    };
    const isBefore = (a, b) => a.block - b.block || a.line - b.line || a.at - b.at;
    runs.forEach((run, i) => {
      const here = next(run);
      const after = here && i + 1 < runs.length && next(runs[i + 1]);
      if (!here || (after && isBefore(after, here) < 0)) return;
      from = { ...here, at: here.at + run.text.length };
      found.push({ block: blocks[here.block], line: here.line, start: here.at, end: from.at, run });
    });
    return found;
  }

  // A link knows the words before it on its printed line, which tells "the
  // result" from an earlier "result". They are missing when the link started a
  // line that has since joined the one above.
  function indexOfRun(line, run, from) {
    if (run.before) {
      const at = line.indexOf(run.before + run.text, Math.max(0, from - run.before.length));
      if (at >= 0) return at + run.before.length;
    }
    return line.indexOf(run.text, from);
  }

  // A link that wraps onto a second line is two links in the file ("Role" /
  // "Confusion"). Once the lines join, they are one link again.
  function joinLinks(blocks, found) {
    const joined = [];
    for (const at of found) {
      const last = joined[joined.length - 1];
      const same = last && last.block === at.block && last.line === at.line && last.run.href === at.run.href && last.end <= at.start;
      if (same && !at.block.lines[at.line].slice(last.end, at.start).trim()) last.end = at.end;
      else joined.push({ ...at });
    }
    return joined;
  }

  // Wraps each run's stretch of the line in its tags. Runs can overlap (a link
  // inside bold text, or half in it), so a tag that would cross another closes
  // and opens again around it.
  function markUp(line, runs) {
    runs = runs.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start || b.end - a.end);
    const cuts = [...new Set([0, line.length, ...runs.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
    const open = [];
    let html = '';
    cuts.forEach((cut, i) => {
      const reopen = [];
      while (open.some((r) => r.end === cut)) {
        const top = open.pop();
        html += top.close;
        if (top.end !== cut) reopen.unshift(top);
      }
      for (const r of [...reopen, ...runs.filter((r) => r.start === cut)]) {
        html += r.open;
        open.push(r);
      }
      if (i + 1 < cuts.length) html += escapeHtml(line.slice(cut, cuts[i + 1]));
    });
    return html;
  }

  // A paste looks like PDF text when it is plain text only and several long
  // lines stop mid-sentence, with the sentence carrying on in lowercase on the
  // next line. Code and short lists don't qualify.
  const PDF_MIN_LINES = 4;
  const PDF_MAX_CODE_SHARE = 0.2; // more lines than this look like code (indented, or ending in { } ;)
  const PDF_MIN_WRAP_SHARE = 0.25; // at least this share of lines must stop mid-sentence
  const PDF_MIN_WRAP_CHARS = 30; // the typical such line is at least this long; shorter is a poem or a list
  function looksLikePdf(text) {
    const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
    const filled = lines.filter((l) => l.trim());
    if (filled.length < PDF_MIN_LINES) return false;
    const code = filled.filter((l) => /^\s{2,}\S|[{};]\s*$/.test(l)).length;
    if (code / filled.length > PDF_MAX_CODE_SHARE) return false;
    const wraps = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i].trimEnd();
      const b = lines[i + 1];
      if (a && /^\p{Ll}/u.test(b) && (!/[.!?:;,]$/.test(a) || new RegExp(`${HYPHEN}$`).test(a))) wraps.push(a.length);
    }
    if (wraps.length < 2 || wraps.length / filled.length < PDF_MIN_WRAP_SHARE) return false;
    wraps.sort((x, y) => x - y);
    return wraps[Math.floor(wraps.length / 2)] >= PDF_MIN_WRAP_CHARS;
  }

  root.pdfToHtml = pdfToHtml;
  root.looksLikePdf = looksLikePdf;
  root.pdfListMarker = listMarker;
  root.keepHyphenForTest = (l, r, text) => keepHyphen(l, r, wordCounts(normalise(text)));
})(globalThis);

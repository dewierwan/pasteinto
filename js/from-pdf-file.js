// cspell:ignore pdfjs demi
// Reads a PDF file itself (pasted from Finder, or dropped on the page) rather
// than text copied from a PDF viewer. A viewer's copy carries no links: Preview
// and Chrome put only the words on the clipboard. The file has them, along
// with each line's position, font and size, so links, bold and headings come
// through. The text then takes the same route as a copy (js/from-pdf.js).
//
// The file is read by Mozilla's pdf.js (js/vendor/pdfjs), loaded only when a
// PDF arrives because it is about 1.9 MB.
(function (root) {
  const PDFJS_VERSION = '6.5.438';
  const PDFJS = `js/vendor/pdfjs/pdf.min.mjs?v=${PDFJS_VERSION}`;
  const PDFJS_WORKER = `js/vendor/pdfjs/pdf.worker.min.mjs?v=${PDFJS_VERSION}`;

  const BOLD_FONT = /bold|black|heavy|semibold|demi/i; // "TimesNewRomanPS-BoldMT"
  const BOLD_MAX_PAGES = 50; // font names need each page's drawing commands, which is slow for a book
  const LINK = /^(https?:|mailto:)/i; // links inside the document (to a page or heading) are left out
  const PARAGRAPH_GAP = 1.3; // a gap this much bigger than the usual line spacing starts a new paragraph
  const SAME_INDENT = 1.5; // points: lines starting within this of each other line up
  const LINK_CONTEXT = 24; // characters before a link kept to find it again in the rebuilt paragraph
  const LINK_SLACK = 2; // points: a link's box sits a little off its text's baseline and edges

  /** @param {{ type?: string, name?: string } | null | undefined} file */
  function isPdfFile(file) {
    return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
  }

  let pdfjs;
  // The page's own address, so this works from pasteinto.com and the extension alike.
  function loadPdfjs() {
    pdfjs ||= import(new URL(PDFJS, document.baseURI).href).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER, document.baseURI).href;
      return lib;
    });
    // A failed load (offline) is tried again on the next file.
    pdfjs.catch(() => {
      pdfjs = null;
    });
    return pdfjs;
  }

  /** @param {Blob} file @returns {Promise<Clip>} */
  async function readPdfFile(file) {
    const lib = await loadPdfjs();
    return readPdfData(lib, new Uint8Array(await file.arrayBuffer()));
  }

  // lib: pdf.js; data: the file's bytes. Returns the paste the file stands for.
  /** @returns {Promise<Clip>} */
  async function readPdfData(lib, data) {
    // isEvalSupported: pdf.js must never build code from a file's contents.
    const task = lib.getDocument({ data, isEvalSupported: false, fontExtraProperties: true, verbosity: 0 });
    try {
      const doc = await task.promise;
      const pages = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        const annotations = await page.getAnnotations();
        pages.push({
          items: content.items.map((item) => ({ ...item, bold: false })),
          links: annotations
            .filter((a) => a.subtype === 'Link' && LINK.test(a.url || ''))
            .map((a) => ({ href: a.url, rect: a.rect, text: a.overlaidText })),
        });
        if (n <= BOLD_MAX_PAGES) await markBoldItems(page, pages[pages.length - 1].items);
        page.cleanup();
      }
      return pdfPagesToClip(pages);
    } finally {
      await task.destroy();
    }
  }

  // pdf.js names a font only once it has read the page's drawing commands.
  // Bold is a nicety, so a page that fails here just keeps its text plain.
  async function markBoldItems(page, items) {
    try {
      await page.getOperatorList();
      const bold = new Map();
      for (const item of items) {
        if (!bold.has(item.fontName)) {
          const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null;
          bold.set(item.fontName, !!font && (font.bold === true || font.black === true || BOLD_FONT.test(font.name || '')));
        }
        item.bold = bold.get(item.fontName);
      }
    } catch {
      // keep the text plain
    }
  }

  // pages: each page's text items, as pdf.js gives them (str, transform, width,
  // height, hasEOL, plus bold), and its links (href, rect, and the text under
  // the link when pdf.js worked it out).
  /** @returns {Clip} */
  function pdfPagesToClip(pages) {
    const text = [];
    const format = { lines: [], bold: [], links: [] };
    for (const page of pages) {
      const lines = printedLines(page.items);
      const breaks = paragraphBreaks(lines);
      const links = [];
      for (const link of page.links) links.push(...linkRuns(link, lines));
      links.sort((a, b) => a.line - b.line || a.at - b.at);
      lines.forEach((line, i) => {
        if (breaks.has(i)) text.push('');
        text.push(line.text);
        format.lines.push({ text: line.text, size: line.size });
        format.bold.push(...boldRuns(line));
      });
      format.links.push(...links.map(({ text, before, href }) => ({ text, before, href })));
    }
    return { text: text.join('\n'), html: '', types: ['Files'], pdf: format };
  }

  // Groups a page's text items into printed lines. Each line keeps, for every
  // character, roughly where it starts across the page and whether it is bold.
  function printedLines(items) {
    const lines = [];
    let line = newLine();
    const finish = () => {
      while (line.text.endsWith(' ')) line.text = line.text.slice(0, -1);
      if (line.text) {
        line.xs.length = line.bold.length = line.text.length;
        line.size = [...line.sizes].sort((a, b) => b[1] - a[1])[0][0];
        lines.push(line);
      }
      line = newLine();
    };
    for (const item of items) {
      const [a, b, c, d, x, y] = item.transform;
      // Text turned on its side (a margin stamp, a watermark) isn't part of the page's text.
      const sideways = Math.abs(b) > Math.abs(a);
      if (item.str && !sideways) {
        const size = Math.round((item.height || Math.hypot(c, d)) * 10) / 10;
        if (!line.text) line.y = y;
        const chars = Array.from(item.str);
        chars.forEach((char, i) => {
          const space = /\s/.test(char);
          // Runs of spaces count once, and none starts a line.
          if (space && (!line.text || line.text.endsWith(' '))) return;
          for (let unit = 0; unit < char.length; unit++) {
            line.xs.push(x + (item.width * i) / chars.length);
            line.bold.push(item.bold && !space);
          }
          line.text += space ? ' ' : char;
          if (!space) line.sizes.set(size, (line.sizes.get(size) || 0) + 1);
        });
      }
      if (item.hasEOL) finish();
    }
    finish();
    return lines;
  }

  function newLine() {
    return { text: '', xs: [], bold: [], sizes: new Map(), size: 0, y: 0 };
  }

  // A copy from a viewer has no blank lines, so paragraphs have to be guessed
  // from line lengths. The file says where lines sit, which settles two cases.
  // Returns the lines (by index) that start a new paragraph.
  function paragraphBreaks(lines) {
    const breaks = new Set();
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i - 1].y - lines[i].y;
      if (gap > 0) gaps.push(gap);
    }
    gaps.sort((a, b) => a - b);
    const spacing = gaps[Math.floor(gaps.length / 2)] || 0;
    // Bullets whose wrapped lines are indented to line up with the bullet's text.
    const textStart = (line) => line.xs[markerOf(line).length] ?? line.xs[0];
    const hanging = lines.some(
      (line, i) => i > 0 && markerOf(lines[i - 1]) && !markerOf(line) && Math.abs(line.xs[0] - textStart(lines[i - 1])) < SAME_INDENT,
    );
    let bullet = null; // the bullet line whose item the current line may carry on
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i - 1].y - lines[i].y;
      if (markerOf(lines[i - 1])) bullet = lines[i - 1];
      // More space above it than between ordinary lines. A jump up the page is a new column, not a paragraph.
      const spaced = spacing && gap > spacing * PARAGRAPH_GAP;
      // Back out at the bullet's own margin: the item is over ("● Wrote Against
      // Telepathy." / "Summer Program on Applied Rationality, Instructor").
      const backOut = hanging && bullet && !markerOf(lines[i]) && lines[i].xs[0] < bullet.xs[0] + SAME_INDENT;
      if (spaced || backOut) breaks.add(i);
      if (spaced || backOut || gap <= 0) bullet = null;
    }
    return breaks;
  }

  // The bullet at the start of a line ("● "), or '' when it has none.
  function markerOf(line) {
    const marker = pdfListMarker(line.text);
    return marker && marker.type === 'ul' ? line.text.slice(0, marker.length) : '';
  }

  // The bold stretches of a line, as text.
  function boldRuns(line) {
    const runs = [];
    let run = '';
    for (let i = 0; i <= line.text.length; i++) {
      // A space between two bold words is bold too.
      const bold = i < line.text.length && (line.bold[i] || (line.text[i] === ' ' && run && line.bold[i + 1]));
      if (bold) run += line.text[i];
      else if (run) {
        runs.push(run);
        run = '';
      }
    }
    return runs;
  }

  // A link is a box on the page. This finds the words under it: on each line
  // the box covers, the text, the words just before it, and where it starts.
  function linkRuns(link, lines) {
    const [x1, y1, x2, y2] = link.rect;
    const runs = [];
    lines.forEach((line, index) => {
      if (line.y < y1 - LINK_SLACK || line.y > y2) return;
      // pdf.js often knows the text under a link. Take its word for it when the
      // text is on this line; of several matches, the one nearest the box.
      const known = (link.text || '').replace(/\s+/g, ' ').trim();
      let at = -1;
      for (let i = known ? line.text.indexOf(known) : -1; i >= 0; i = line.text.indexOf(known, i + 1)) {
        if (at < 0 || Math.abs(line.xs[i] - x1) < Math.abs(line.xs[at] - x1)) at = i;
      }
      let text = known;
      if (at < 0) {
        // Otherwise the characters that start inside the box. Their positions
        // are estimates, so the ends move to the nearest edge of a word.
        let start = line.xs.findIndex((x) => x >= x1 - LINK_SLACK);
        let end = line.xs.findLastIndex((x) => x < x2 - LINK_SLACK) + 1;
        if (start < 0 || end <= start) return;
        start = wordEdge(line.text, start);
        end = wordEdge(line.text, end);
        text = line.text.slice(start, end).trim();
        at = line.text.indexOf(text, start);
      }
      if (text) runs.push({ line: index, at, text, before: line.text.slice(Math.max(0, at - LINK_CONTEXT), at), href: link.href });
    });
    return runs;
  }

  // The nearest start or end of a word to this position in the text.
  function wordEdge(text, at) {
    let back = at;
    let forward = at;
    while (back > 0 && text[back - 1] !== ' ') back--;
    while (forward < text.length && text[forward] !== ' ') forward++;
    return at - back <= forward - at ? back : forward;
  }

  root.isPdfFile = isPdfFile;
  root.readPdfFile = readPdfFile;
  root.readPdfData = readPdfData;
  root.pdfPagesToClip = pdfPagesToClip;
})(globalThis);

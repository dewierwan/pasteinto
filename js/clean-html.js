// Normalises pasted HTML into a small, predictable subset: lines and
// paragraphs, <b>/<i>/<u>/<s>, links, lists, tables, quotes and code.
// Fonts, sizes, colours, line height and margins are dropped.
//
// target "rich": the markup Gmail's compose box writes itself (<div> lines).
//   headings "bold" (email: Gmail, Outlook and Slack have no headings) turns
//   headings into bold lines; headings "keep" (Docs, Notion, Airtable) keeps
//   <h1>–<h6> at their original level.
//   tasks "text" (email, Slack, text outputs) writes task boxes as ☐ and ☒
//   characters; tasks "inputs" (Docs) writes checklists that Notion and
//   Airtable turn into real ones (see DOCS_TASK_LIST_STYLE).
// target "markdown": semantic tags (<p>, <h1>, <pre>, <input type="checkbox">)
//   for the Markdown writer.
//
// spacing "tags" (most apps): <p> and headings are spaced paragraphs, <div>s are
// lines. spacing "margins" (Google Docs): every paragraph is a <p> line, with a
// blank line where a paragraph has space above or below it, or is empty.
// js/sources.js says which an app uses, and rewrites app quirks before this runs.
(function (root) {
  const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'META', 'TITLE', 'HEAD', 'LINK', 'COLGROUP', 'COL']);
  const BLOCK_TAGS = new Set([
    'P',
    'DIV',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'SECTION',
    'ARTICLE',
    'HEADER',
    'FOOTER',
    'MAIN',
    'ASIDE',
    'NAV',
    'FIGURE',
    'FIGCAPTION',
  ]);
  const STRUCTURE_TAGS = new Set(['UL', 'OL', 'TABLE', 'HR', 'PRE', 'BLOCKQUOTE', ...BLOCK_TAGS]);
  const MERGEABLE_TAGS = new Set(['B', 'I', 'U', 'S', 'SUB', 'SUP', 'A', 'CODE', 'FONT']);
  const OL_TYPES = { 'lower-alpha': 'a', 'upper-alpha': 'A', 'lower-roman': 'i', 'upper-roman': 'I' };
  const LIST_STYLE = ' style="margin-top:0;margin-bottom:0"'; // as on lists Gmail creates
  const QUOTE_STYLE = ' style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex"'; // Gmail's quote
  const EMPTY_LINE = '<div><br></div>';
  // Task boxes in rich and text outputs. Not ☑: it is also an emoji, and Gmail
  // swaps it for a coloured image even after U+FE0E (checked live 3 Oct 2026),
  // next to a plain ☐. ☒ has no emoji form.
  const TICKED_BOX = '☒';
  const OPEN_BOX = '☐';
  const TASK_INDENT = '&nbsp;'.repeat(4); // per nesting level, as list items indent in text output
  // Docs output: each destination reads a different hint and ignores the
  // others (checked live 3 Oct 2026; see tests/destinations.test.js):
  //   Notion       <input type="checkbox"> → a real to-do
  //   Airtable     <ul data-checked>, nesting as class="ql-indent-N" → a real checklist
  //   Google Docs  can't make a checklist from pasted HTML, and a visible box
  //                (character or image) would show up inside Notion's to-do,
  //                so tasks get square bullets there, the only marker it honours
  const DOCS_TASK_LIST_STYLE = ' style="margin-top:0;margin-bottom:0;list-style-type:square"';

  function cleanHtml(html, options = {}) {
    const opts = {
      target: options.target || 'rich',
      headings: options.headings || 'bold',
      margins: options.spacing === 'margins',
    };
    // Task boxes as ☐/☒ characters (email, Slack, text), or as the Docs
    // output's checkboxes that Notion, Airtable and Google Docs each read.
    opts.textBoxes = opts.target === 'rich' && options.tasks !== 'inputs';
    opts.docsTasks = opts.target === 'rich' && options.tasks === 'inputs';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const start = {
      b: false,
      i: false,
      u: false,
      s: false,
      sup: false,
      sub: false,
      code: false,
      mark: false,
      heading: false,
      pre: false,
      href: null,
    };
    const out = convertChildren(doc.body, start, 'block', opts);
    return finish(out, opts);
  }

  function convertChildren(el, fmt, mode, opts) {
    return convertNodes(el.childNodes, fmt, mode, opts);
  }

  function convertNodes(nodes, fmt, mode, opts) {
    if (mode === 'block')
      return wrapLooseText(
        Array.from(nodes, (child) => convertNode(child, fmt, mode, opts)),
        opts,
      );
    let html = '';
    let prevWasBlock = false;
    for (const child of nodes) {
      const isBlock = child.nodeType === 1 && BLOCK_TAGS.has(child.tagName);
      // Inside a list item or table cell, separate paragraphs with line breaks.
      if (isBlock && prevWasBlock) html += '<br>';
      html += convertNode(child, fmt, mode, opts);
      if (child.nodeType === 1 || child.textContent.trim()) prevWasBlock = isBlock;
    }
    return html;
  }

  // Text loose among blocks is a line of its own: Gmail writes
  // <div>Hi Sam,<div><br></div><div>Thanks…</div></div>. With no blocks around
  // it (a selection inside one paragraph), it stays inline.
  function wrapLooseText(parts, opts) {
    const isBlock = (part) => /^<(div|p|h[1-6]|ul|ol|table|blockquote|pre|hr)[\s>]/.test(part);
    if (!parts.some(isBlock)) return parts.join('');
    let html = '';
    let loose = '';
    const flush = () => {
      if (loose.replace(/<br>|&nbsp;|\s/g, '')) html += opts.target === 'rich' ? `<div>${loose}</div>` : `<p>${loose}</p>`;
      loose = '';
    };
    for (const part of parts) {
      if (isBlock(part)) {
        flush();
        html += part;
      } else {
        loose += part;
      }
    }
    flush();
    return html;
  }

  function convertNode(node, fmt, mode, opts) {
    if (node.nodeType === 3) return renderText(node.textContent, fmt, opts);
    if (node.nodeType !== 1) return '';

    const tag = node.tagName;
    const rich = opts.target === 'rich';
    if (SKIP_TAGS.has(tag)) return '';
    if (tag === 'BR') return mode === 'block' ? (rich ? EMPTY_LINE : '') : '<br>';
    if (tag === 'HR') return '<hr>';
    if (tag === 'IMG') return renderImage(node);
    if (tag === 'INPUT') {
      if (node.type !== 'checkbox') return '';
      const input = node.checked ? '<input type="checkbox" checked>' : '<input type="checkbox">';
      if (!opts.textBoxes) return input;
      return node.checked ? `${TICKED_BOX} ` : `${OPEN_BOX} `;
    }
    if (tag === 'PRE') return renderCodeBlock(node, opts);

    const f = nextFormat(node, fmt);
    if (tag === 'UL' || tag === 'OL') return renderList(node, f, opts);
    if (tag === 'TABLE') return renderTable(node, f, opts);
    if (tag === 'BLOCKQUOTE') {
      const inner = convertChildren(node, f, 'block', opts);
      return rich ? `<blockquote${QUOTE_STYLE} data-p>${inner}</blockquote>` : `<blockquote>${inner}</blockquote>`;
    }

    if (BLOCK_TAGS.has(tag)) {
      // A wrapper (e.g. the div around a Docs table) is transparent.
      if (hasStructureChild(node)) return convertChildren(node, f, mode, opts);
      const inner = convertChildren(node, f, 'inline', opts);
      return mode === 'block' ? wrapBlock(node, inner, opts) : inner;
    }
    // Inline wrappers (span, b, a, ...) pass the mode through: Docs wraps whole
    // documents in <b style="font-weight:normal">.
    return convertChildren(node, f, mode, opts);
  }

  function wrapBlock(node, inner, opts) {
    const tag = node.tagName;
    const heading = /^H[1-6]$/.test(tag);
    const empty = !inner.replace(/<br>|&nbsp;|\s/g, ''); // includes Word's <p>&nbsp;</p>
    if (opts.target === 'markdown') {
      if (empty) return '';
      return heading ? `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>` : `<p>${inner}</p>`;
    }
    if (empty) return EMPTY_LINE;
    // Real headings carry their own spacing, so no blank lines around them.
    if (heading && opts.headings === 'keep') return `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
    // Spaced by tags: <p> and headings are spaced paragraphs; <div>s are lines.
    const spaced = !opts.margins && (tag === 'P' || heading);
    // Spaced by margins: a paragraph is a line unless it has space after (or before) it.
    const gapAfter = opts.margins && tag === 'P' && hasSpacing(node.style.marginBottom);
    const gapBefore = opts.margins && tag === 'P' && hasSpacing(node.style.marginTop);
    const attrs = (spaced ? ' data-p' : '') + (gapAfter ? ' data-gap-after' : '') + (gapBefore ? ' data-gap-before' : '');
    return `<div${attrs}>${inner}</div>`;
  }

  function hasSpacing(margin) {
    return parseFloat(margin) >= 6; // pt or px; Docs writes pt
  }

  function hasStructureChild(el) {
    return Array.from(el.children).some((c) => STRUCTURE_TAGS.has(c.tagName));
  }

  function nextFormat(el, fmt) {
    const f = { ...fmt };
    const tag = el.tagName;
    if (tag === 'B' || tag === 'STRONG') f.b = true;
    if (tag === 'I' || tag === 'EM') f.i = true;
    if (tag === 'U' || tag === 'INS') f.u = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.s = true;
    if (tag === 'SUP') f.sup = true;
    if (tag === 'SUB') f.sub = true;
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') f.code = true;
    if (tag === 'MARK') f.mark = true;
    if (/^H[1-6]$/.test(tag)) f.heading = true;
    if (tag === 'A') {
      const href = cleanHref(el.getAttribute('href'));
      if (href) f.href = href;
    }

    // Docs (and others) put the real formatting in inline styles; these override tags.
    // "inherit" keeps the parent's value: Airtable writes
    // <strong><em style="font-weight: inherit">, which is still bold.
    const st = el.style;
    const inherits = (value) => value === 'inherit' || value === 'unset';
    if (st.fontWeight && !inherits(st.fontWeight))
      f.b = st.fontWeight === 'bold' || st.fontWeight === 'bolder' || parseInt(st.fontWeight, 10) >= 600;
    if (st.fontStyle && !inherits(st.fontStyle)) f.i = st.fontStyle === 'italic' || st.fontStyle === 'oblique';
    const deco = st.textDecorationLine || st.textDecoration;
    if (deco && !inherits(deco)) {
      f.u = deco.includes('underline');
      f.s = deco.includes('line-through');
    }
    if (st.whiteSpace) f.pre = st.whiteSpace.startsWith('pre') || st.whiteSpace === 'break-spaces';
    if (st.verticalAlign) {
      f.sup = st.verticalAlign === 'super';
      f.sub = st.verticalAlign === 'sub';
    }
    return f;
  }

  function cleanHref(href) {
    if (!href) return null;
    href = href.trim();
    // Unwrap Google redirect links: https://www.google.com/url?q=<real>&sa=D...
    const redirect = href.match(/^https?:\/\/(www\.)?google\.com\/url\?(.*)$/);
    if (redirect) {
      const q = new URLSearchParams(redirect[2]).get('q');
      if (q) href = q;
    }
    return /^(https?:|mailto:|tel:)/i.test(href) ? href : null;
  }

  function renderText(text, fmt, opts) {
    // Ignore source-code whitespace between tags (newlines plus indentation).
    if (/^\s*$/.test(text) && text.includes('\n')) return '';
    let t = escapeHtml(text)
      .replace(/\t/g, '    ')
      .replace(/ {2}/g, '  ') // Docs keeps runs of spaces; HTML would collapse them.
      // A newline is a line break only in preformatted text (VS Code writes
      // white-space: pre); elsewhere it is a space, as a browser shows it.
      // Notion puts newlines between its tags: <li>Hiring update\n<ul>.
      .replace(/\r?\n/g, fmt.pre ? '<br>' : ' ');
    if (!t) return '';
    const rich = opts.target === 'rich';
    if (fmt.code) t = rich ? `<font face="monospace">${t}</font>` : `<code>${t}</code>`;
    if (fmt.mark && !rich) t = `<mark>${t}</mark>`;
    if (fmt.sub) t = `<sub>${t}</sub>`;
    if (fmt.sup) t = `<sup>${t}</sup>`;
    if (fmt.s) t = `<s>${t}</s>`;
    if (fmt.u && !fmt.href) t = `<u>${t}</u>`; // links are underlined already
    if (fmt.i) t = `<i>${t}</i>`;
    if (fmt.b || (fmt.heading && rich && opts.headings === 'bold')) t = `<b>${t}</b>`;
    if (fmt.href) t = `<a href="${escapeAttr(fmt.href)}">${t}</a>`;
    return t;
  }

  function renderImage(img) {
    const src = img.getAttribute('src') || '';
    if (!/^https?:/i.test(src)) return '';
    const width = parseInt(img.getAttribute('width') || img.style.width, 10);
    const widthAttr = width > 0 ? ` width="${width}"` : '';
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(img.getAttribute('alt') || '')}"${widthAttr}>`;
  }

  function renderCodeBlock(pre, opts) {
    const code = escapeHtml(pre.textContent.replace(/\n$/, ''));
    if (opts.target === 'markdown') {
      const codeEl = pre.querySelector('code');
      const langClass = Array.from((codeEl || pre).classList).find((c) => c.startsWith('language-'));
      const lang = pre.getAttribute('data-language') || (langClass ? langClass.slice(9) : '');
      return `<pre${lang ? ` data-language="${escapeAttr(lang)}"` : ''}>${code}</pre>`;
    }
    return `<div data-p><font face="monospace">${code.replace(/\n/g, '<br>').replace(/ {2}/g, '  ')}</font></div>`;
  }

  // Some apps (Google Docs, Quill, Word once fixed) write nested lists flat, with
  // aria-level on each <li>; others nest properly. Flatten to (level, type,
  // content), then rebuild.
  function renderList(listEl, fmt, opts) {
    const items = [];
    collectListItems(listEl, 0, fmt, opts, items);
    const depths = depthsOf(items);
    items.forEach((item, i) => (item.level = depths[i]));
    if (opts.target !== 'rich') return listHtml(items, opts);
    // Email, Slack and the text outputs have no checklists, and a bullet before
    // the box ("• ☐ Book venue") reads as two markers. Tasks become lines that
    // start with the box, nesting as indentation; any ordinary items around
    // them stay lists. Slack ignores list-style-type, so a box can't simply
    // replace an item's bullet.
    let html = '';
    if (opts.textBoxes) {
      for (const run of runs(items, (item) => item.task)) {
        html += run[0].task ? run.map((item) => `<div>${TASK_INDENT.repeat(item.level)}${item.html}</div>`).join('') : listHtml(run, opts);
      }
    } else {
      html = listHtml(items, opts);
    }
    // The list is spaced as one block, then its parts stand on their own.
    return opts.margins ? html : `<div data-p data-lines>${html}</div>`;
  }

  // Turns the levels the app wrote into nesting depths. A copy can start below
  // the top level (two sub-bullets copied from Airtable are both ql-indent-1)
  // or skip a level (0, then 2), and items at the same written level are
  // siblings either way: [1, 1] becomes [0, 0] and [0, 2, 2] becomes [0, 1, 1].
  function depthsOf(items) {
    const open = []; // written levels of the lists that enclose the current item
    return items.map((item) => {
      while (open.length && open[open.length - 1] > item.level) open.pop();
      if (!open.length || open[open.length - 1] < item.level) open.push(item.level);
      return open.length - 1;
    });
  }

  // Splits items into runs that share key(item).
  function runs(items, key) {
    const out = [];
    for (const item of items) {
      const last = out[out.length - 1];
      if (last && key(last[0]) === key(item)) last.push(item);
      else out.push([item]);
    }
    return out;
  }

  // Rich outputs put a nested list beside its parent item, not inside it, and
  // mark each nested item with class="ql-indent-N". That is how Gmail and
  // Google Docs write nesting, and the only nesting the Quill editors in Slack
  // and Airtable read: given a list inside an item, they merge the items into
  // one line ("OneOne AOne A i"). Checked live 3 Oct 2026.
  function listHtml(items, opts) {
    const rich = opts.target === 'rich';
    let html = '';
    const stack = []; // open lists: { tag, open, liOpen }
    const close = () => {
      const list = stack.pop();
      return `${list.liOpen ? '</li>' : ''}</${list.tag}>`;
    };
    const closeItem = (list) => {
      if (list && list.liOpen) {
        list.liOpen = false;
        return '</li>';
      }
      return '';
    };
    // A run of ordinary items between tasks can start below the top level.
    const depths = depthsOf(items);
    items.forEach((item, i) => {
      const level = depths[i];
      while (stack.length > level + 1) html += close();
      if (stack.length === level + 1 && stack[level].open !== item.open) html += close();
      if (stack.length === level + 1) {
        html += closeItem(stack[level]);
      } else {
        if (rich) html += closeItem(stack[stack.length - 1]);
        html += item.open;
        stack.push({ tag: item.tag, open: item.open, liOpen: false });
      }
      html += rich && level > 0 ? `<li class="ql-indent-${level}">` : '<li>';
      html += item.html;
      stack[stack.length - 1].liOpen = true;
    });
    while (stack.length) html += close();
    return html;
  }

  function collectListItems(listEl, depth, fmt, opts, items) {
    for (const child of listEl.children) {
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        collectListItems(child, depth + 1, fmt, opts, items);
      } else if (child.tagName === 'LI') {
        const ariaLevel = parseInt(child.getAttribute('aria-level'), 10);
        const listType = child.getAttribute('data-list-type');
        const tag = listType === 'ul' || listType === 'ol' ? listType : listEl.tagName.toLowerCase();
        const type = tag === 'ol' && OL_TYPES[child.style.listStyleType];
        const isList = (node) => node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL');
        const nested = Array.from(child.childNodes).filter(isList);
        const content = Array.from(child.childNodes).filter((node) => !isList(node));
        const html = convertNodes(content, nextFormat(child, fmt), 'inline', opts);
        const style = opts.target === 'rich' ? LIST_STYLE : '';
        const isBox = (node) =>
          node.nodeType === 1 && (node.matches('input[type="checkbox"]') || !!node.querySelector('input[type="checkbox"]'));
        const holder = content.find(isBox);
        const box = holder && (holder.matches('input') ? holder : holder.querySelector('input[type="checkbox"]'));
        const task = !!box;
        // Docs: each run of ticked or unticked tasks is its own list, marked as
        // Airtable marks its checklists.
        const taskList = opts.docsTasks && task;
        const checked = taskList && box.checked ? 'true' : 'false';
        const open = taskList
          ? `<ul data-checked="${checked}"${DOCS_TASK_LIST_STYLE}>`
          : `<${tag}${type ? ` type="${type}"` : ''}${style}>`;
        items.push({
          level: ariaLevel > 0 ? ariaLevel - 1 : depth,
          task,
          tag: taskList ? 'ul' : tag,
          open,
          html: html || '<br>',
        });
        for (const list of nested) collectListItems(list, depth + 1, fmt, opts, items);
      }
    }
  }

  function renderTable(table, fmt, opts) {
    const rich = opts.target === 'rich';
    let html = rich ? '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse" data-p>' : '<table>';
    for (const row of table.rows) {
      html += '<tr>';
      for (const cell of row.cells) {
        const tag = cell.tagName.toLowerCase();
        const span = ['colspan', 'rowspan']
          .filter((a) => parseInt(cell.getAttribute(a), 10) > 1)
          .map((a) => ` ${a}="${parseInt(cell.getAttribute(a), 10)}"`)
          .join('');
        html += `<${tag}${span}>${convertChildren(cell, nextFormat(cell, fmt), 'inline', opts) || (rich ? '<br>' : '')}</${tag}>`;
      }
      html += '</tr>';
    }
    return `${html}</table>`;
  }

  // Joins <b>Hello </b><b>world</b>, puts a blank line between spaced
  // paragraphs, collapses repeated blank lines, and trims blank lines at the ends.
  function finish(html, opts) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    mergeChildren(doc.body);
    if (opts.target === 'rich') {
      spaceParagraphs(doc.body, opts);
      // A task list is spaced as one block, then its lines stand on their own.
      for (const el of doc.body.querySelectorAll('[data-lines]')) el.replaceWith(...el.childNodes);
      for (const el of doc.body.querySelectorAll('[data-p], [data-gap-after], [data-gap-before]')) {
        el.removeAttribute('data-p');
        el.removeAttribute('data-gap-after');
        el.removeAttribute('data-gap-before');
      }
      trimEmptyLines(doc.body);
    }
    return doc.body.innerHTML;
  }

  function mergeChildren(el) {
    let child = el.firstChild;
    while (child) {
      const next = child.nextSibling;
      if (
        next &&
        child.nodeType === 1 &&
        next.nodeType === 1 &&
        MERGEABLE_TAGS.has(child.tagName) &&
        child.tagName === next.tagName &&
        child.getAttribute('href') === next.getAttribute('href') &&
        child.getAttribute('face') === next.getAttribute('face')
      ) {
        while (next.firstChild) child.appendChild(next.firstChild);
        next.remove();
        continue;
      }
      child = next;
    }
    for (const c of el.children) mergeChildren(c);
  }

  function isEmptyLine(el) {
    return el && el.tagName === 'DIV' && el.childNodes.length === 1 && el.firstChild.nodeName === 'BR';
  }

  function spaceParagraphs(container, opts) {
    for (const quote of container.querySelectorAll('blockquote')) spaceParagraphs(quote, opts);
    const children = Array.from(container.children);
    children.forEach((el, i) => {
      const prev = children[i - 1];
      const spaced = prev && el.hasAttribute('data-p') && prev.hasAttribute('data-p');
      const marginGap =
        prev && !isEmptyLine(el) && !isEmptyLine(prev) && (prev.hasAttribute('data-gap-after') || el.hasAttribute('data-gap-before'));
      if (spaced || marginGap) {
        el.insertAdjacentHTML('beforebegin', EMPTY_LINE);
      }
    });
    if (!opts.margins) {
      // Word and web pages often pad with empty paragraphs; keep one blank line.
      for (const el of Array.from(container.children)) {
        if (isEmptyLine(el) && isEmptyLine(el.previousElementSibling)) el.remove();
      }
    }
  }

  function trimEmptyLines(body) {
    while (isEmptyLine(body.firstChild)) body.firstChild.remove();
    while (isEmptyLine(body.lastChild)) body.lastChild.remove();
  }

  root.cleanHtml = cleanHtml;
})(globalThis);

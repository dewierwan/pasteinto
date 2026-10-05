// Writes Markdown from the cleaner's output (js/clean-html.js, target
// "markdown"): <p>, <h1>–<h6>, <b>, <i>, <s>, <u>, <code>, <mark>, <sub>,
// <sup>, <a>, <br>, lists, tables, <blockquote>, <pre data-language>, <hr>,
// <img> and task-list <input type="checkbox">. Also has the clean-up passes for
// Markdown that other tools put on the clipboard.
(function (root) {
  // When plain markdown is pasted, the browser hands us a single <pre>, which the
  // converter wraps in a code fence. Strip the outer fence so pasted markdown round-
  // trips cleanly. Bail out if the inner content contains its own fences (real code
  // blocks should pass through untouched).
  function stripWrappingFence(markdown) {
    const trimmed = markdown.trim();
    const match = trimmed.match(/^```[^\n]*\n([\s\S]*)\n```$/);
    if (!match) return markdown;
    if (/^```/m.test(match[1])) return markdown;
    return match[1];
  }

  // Google Docs' "Copy as Markdown" over-escapes punctuation that has no markdown
  // meaning (\~, \., \<, \>, \$, \&). Strip those backslashes so the output matches
  // the source. Negative lookbehind avoids rewriting a literal escaped backslash.
  function unescapeOverEscaped(markdown) {
    return markdown.replace(/(?<!\\)\\([~.<>$&])/g, '$1');
  }

  // Strip image markdown so pasted Google Docs base64 blobs never reach the output.
  function stripImages(markdown) {
    return (
      markdown
        // Reference definitions pointing to data: URLs (the massive base64 blob).
        .replace(/^[ \t]*\[[^\]\n]+\]:[ \t]*<?\s*data:[^\n]*>?[ \t]*$/gim, '')
        // Inline images: ![alt](url)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        // Reference-style images: ![alt][ref]
        .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
        // Tidy: trim trailing spaces per line, collapse 3+ blank lines to 2.
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
    );
  }

  // DOMParser builds an inert document: pasted HTML set as innerHTML on a live
  // element would run its event handlers (<img src=x onerror=...>), even though
  // the element is never shown.
  function convertToMarkdown(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return convertNode(doc.body, 0)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Escape characters that would otherwise be parsed as Markdown formatting.
  // Conservative set: chars that are inline-meaningful in any position.
  function escapeMarkdown(text) {
    return text.replace(/([\\`*_[\]~])/g, '\\$1');
  }

  function convertNode(node, indent) {
    if (node.nodeType === 3) return escapeMarkdown(node.textContent);
    if (node.nodeType !== 1) return '';
    const inner = () => convertChildren(node, indent);
    const tag = node.tagName.toLowerCase();
    switch (tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return `${'#'.repeat(Number(tag[1]))} ${inner()}\n\n`;
      case 'b':
        return wrapMarkers('**', inner());
      case 'i':
        return wrapMarkers('*', inner());
      case 's':
        return wrapMarkers('~~', inner());
      case 'mark':
      case 'sub':
      case 'sup':
        return `<${tag}>${inner()}</${tag}>`;
      case 'code':
        return `\`${node.textContent}\``;
      case 'pre':
        return `\`\`\`${node.getAttribute('data-language') || ''}\n${node.textContent}\n\`\`\`\n\n`;
      case 'blockquote':
        // A blank line inside the quote keeps its ">", or it ends the quote.
        return `${inner()
          .replace(/\s+$/, '')
          .split('\n')
          .map((line) => (line.trim() ? `> ${line}` : '>'))
          .join('\n')}\n\n`;
      case 'ul':
      case 'ol': {
        let out = tag === 'ol' ? '\n' : '';
        let n = 1;
        for (const li of node.children) if (li.tagName === 'LI') out += convertListItem(li, indent, tag === 'ol' ? n++ : null);
        return `${out}\n`; // a blank line after the list
      }
      case 'input':
        return node.hasAttribute('checked') ? '[x] ' : '[ ] ';
      case 'a':
        return `[${inner()}](${node.getAttribute('href') || ''})`;
      case 'img': {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        const title = node.getAttribute('title');
        if (!src) return '';
        return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
      }
      case 'hr':
        return '\n---\n\n';
      case 'br':
        return '\n';
      case 'p':
        return `${inner()}\n\n`;
      case 'table':
        return convertTable(node);
      default:
        return inner();
    }
  }

  function convertChildren(el, indent) {
    let out = '';
    for (const child of el.childNodes) out += convertNode(child, indent);
    return out;
  }

  // number: the item's number in an <ol>, or null in a <ul>.
  function convertListItem(li, indent, number) {
    const pad = '  '.repeat(indent);
    const box = li.querySelector(':scope > input[type="checkbox"]');
    let prefix;
    if (box) {
      prefix = `${pad}${box.hasAttribute('checked') ? '- [x] ' : '- [ ] '}`;
      box.remove();
    } else {
      prefix = `${pad}${number !== null ? `${number}. ` : '- '}`;
    }
    // Nested lists go on their own lines, one level deeper.
    let content = '';
    let nested = '';
    for (const child of li.childNodes) {
      if (child.nodeType === 1 && /^(UL|OL)$/.test(child.tagName)) {
        let sub = convertNode(child, indent + 1).replace(/^\n+|\n+$/g, '');
        // Under "1. " content starts at column 3, so nest one space deeper.
        if (number !== null) sub = sub.replace(/^/gm, ' ');
        nested += `${sub}\n`;
      } else {
        content += convertNode(child, indent);
      }
    }
    // Later lines of the item line up under its first.
    return `${prefix}${content.trim().replace(/\n/g, `\n${' '.repeat(prefix.length)}`)}\n${nested}`;
  }

  function convertTable(table) {
    const allRows = Array.from(table.querySelectorAll('tr'));
    if (allRows.length === 0) return '';
    const theadRows = Array.from(table.querySelectorAll('thead tr'));
    const headerRow = theadRows.length > 0 ? theadRows[0] : allRows[0];
    const bodyRows = theadRows.length > 0 ? allRows.filter((r) => !theadRows.includes(r)) : allRows.slice(1);
    const cellsOf = (tr) => Array.from(tr.children).filter((c) => /^T[HD]$/.test(c.tagName));
    const renderCell = (cell) => convertChildren(cell, 0).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ') || ' ';
    const renderRow = (tr) => `| ${cellsOf(tr).map(renderCell).join(' | ')} |`;
    const colCount = cellsOf(headerRow).length;
    if (colCount === 0) return '';
    let out = `${renderRow(headerRow)}\n|${' --- |'.repeat(colCount)}\n`;
    for (const tr of bodyRows) out += `${renderRow(tr)}\n`;
    return `\n${out}\n`;
  }

  root.convertToMarkdown = convertToMarkdown;
  root.stripWrappingFence = stripWrappingFence;
  root.unescapeOverEscaped = unescapeOverEscaped;
  root.stripImages = stripImages;
})(globalThis);

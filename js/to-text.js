// Writes normalised rich HTML (from cleanHtml, target "rich") as text.
// style "whatsapp": *bold* _italic_ ~strike~ `code`, "- " bullets, "> " quotes.
// style "plain": no markers, "•" bullets, links as "text (url)".
(function (root) {
  function toText(html, style) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const ctx = { wa: style === 'whatsapp' };
    return blocks(doc.body, ctx)
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function blocks(el, ctx) {
    let out = '';
    for (const node of el.childNodes) out += block(node, ctx, 0);
    return out;
  }

  function block(node, ctx, depth) {
    if (node.nodeType !== 1) return inline(node, ctx);
    const tag = node.tagName;
    if (tag === 'DIV') {
      if (node.childNodes.length === 1 && node.firstChild.nodeName === 'BR') return '\n';
      return `${inlineChildren(node, ctx)}\n`;
    }
    if (tag === 'UL' || tag === 'OL') return list(node, ctx, depth);
    if (tag === 'TABLE') {
      return (
        Array.from(node.rows)
          .map((row) =>
            Array.from(row.cells)
              .map((c) => inlineChildren(c, ctx).replace(/\n/g, ' ').trim())
              .join(' | '),
          )
          .join('\n') + '\n'
      );
    }
    if (tag === 'BLOCKQUOTE') {
      return (
        blocks(node, ctx)
          .replace(/\n+$/, '')
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n') + '\n'
      );
    }
    if (tag === 'HR') return '———\n';
    return inline(node, ctx);
  }

  function list(listEl, ctx, depth) {
    let out = '';
    let n = parseInt(listEl.getAttribute('start'), 10) || 1;
    for (const li of listEl.children) {
      // cleanHtml puts a nested list beside its parent item: <ul><li>One</li><ul>…
      if (li.tagName === 'UL' || li.tagName === 'OL') {
        out += list(li, ctx, depth + 1);
        continue;
      }
      if (li.tagName !== 'LI') continue;
      const marker = listEl.tagName === 'OL' ? `${n++}. ` : ctx.wa ? '- ' : '• ';
      let text = '';
      let nested = '';
      for (const child of li.childNodes) {
        if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) nested += list(child, ctx, depth + 1);
        else text += inline(child, ctx);
      }
      // Later lines of the item line up under its first.
      const pad = '    '.repeat(depth);
      out += `${pad}${marker}${text.trim().replace(/\n/g, `\n${pad}${' '.repeat(marker.length)}`)}\n${nested}`;
    }
    return out;
  }

  function inlineChildren(el, ctx) {
    let out = '';
    for (const node of el.childNodes) out += inline(node, ctx);
    return out;
  }

  function inline(node, ctx) {
    if (node.nodeType === 3) return node.textContent.replace(/\u00A0/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName;
    const inner = inlineChildren(node, ctx);
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') return '';
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      const bare = href.replace(/^mailto:/, '');
      return !href || inner.trim() === href || inner.trim() === bare ? inner : `${inner} (${href})`;
    }
    if (!ctx.wa) return inner;
    if (tag === 'B') return wrapMarkers('*', inner);
    if (tag === 'I') return wrapMarkers('_', inner);
    if (tag === 'S') return wrapMarkers('~', inner);
    if (tag === 'FONT' && node.getAttribute('face') === 'monospace')
      return inner.includes('\n') ? `\`\`\`${inner}\`\`\`` : wrapMarkers('`', inner);
    return inner;
  }

  root.toText = toText;
})(globalThis);

// The apps a paste can come from, and the fixes each one's HTML needs before
// js/clean-html.js reads it. A fix rewrites one app's quirks into plain HTML
// that the cleaner understands, so the cleaner and the writers never need to
// know which app a paste came from.
//
// What a fix may produce, beyond ordinary HTML:
//   <li aria-level="N">        nesting level (1 = top), for apps that write flat lists
//   <li data-list-type="ol">   "ul" or "ol", when one list mixes bullets and numbers
//   <input type="checkbox">    a task list item's box, first in the <li>
//
// spacing says how the app marks a blank line between paragraphs:
//   "tags":    <p> is a spaced paragraph and <div> is a single line (most apps)
//   "margins": every paragraph is a <p> line, and a blank line is a <p> with
//              space above or below it, or an empty paragraph (Google Docs)
(function (root) {
  /** @type {App[]} */
  const APPS = [
    { id: 'gdocs', name: 'Google Docs', spacing: 'margins', matches: (clip) => /docs-internal-guid/.test(clip.html) },
    { id: 'notion', name: 'Notion', matches: (clip) => clip.types.some((t) => /notion/i.test(t)) },
    { id: 'word', name: 'Word', matches: (clip) => /urn:schemas-microsoft-com:office|class="?Mso/i.test(clip.html), fix: fixWordLists },
    { id: 'gmail', name: 'Gmail', matches: (clip) => /class="?gmail_/.test(clip.html) },
    { id: 'airtable', name: 'Airtable', matches: (clip) => clip.types.some((t) => /airtable/i.test(t)) },
    // Text copied from Slack's message box, read through js/from-slack.js.
    { id: 'slack', name: 'Slack', matches: (clip) => clip.types.includes(SLACK_TYPE) },
  ];

  // Fixes for markup that many apps share, run on every rich paste.
  const SHARED_FIXES = [fixQuill, fixTextTasks];

  // clip: { html, text, types }. Returns the app the HTML came from, or null.
  function findApp(clip) {
    if (!clip.html) return null;
    const c = { html: clip.html, text: clip.text || '', types: clip.types || [] };
    return APPS.find((app) => app.matches(c)) || null;
  }

  // Returns the paste's HTML with its app's quirks rewritten.
  function fixHtml(html, app) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const fix of SHARED_FIXES) fix(doc);
    if (app && app.fix) app.fix(doc);
    return doc.body.innerHTML;
  }

  // Quill, the editor in Airtable and many web apps, writes flat lists. Quill 1
  // marks nesting with class="ql-indent-N" and task lists with
  // <ul data-checked>; Quill 2 also says per item whether it is a bullet, a
  // number or a task (data-list="bullet|ordered|checked|unchecked").
  function fixQuill(doc) {
    for (const li of doc.querySelectorAll('li[class*="ql-indent-"]')) {
      const indent = parseInt((li.className.match(/\bql-indent-(\d+)/) || [])[1], 10) || 0;
      if (!li.hasAttribute('aria-level')) li.setAttribute('aria-level', String(indent + 1));
    }
    for (const li of doc.querySelectorAll('li[data-list]')) {
      const kind = li.getAttribute('data-list');
      li.setAttribute('data-list-type', kind === 'ordered' ? 'ol' : 'ul');
      if (kind === 'checked' || kind === 'unchecked') addCheckbox(li, kind === 'checked');
    }
    for (const ul of doc.querySelectorAll('ul[data-checked]')) {
      for (const li of ul.children) if (li.tagName === 'LI') addCheckbox(li, ul.getAttribute('data-checked') === 'true');
    }
    // Quill 1 starts a new <ul> each time an item is ticked or cleared, so one
    // checklist arrives as several lists. Join them back into one.
    for (const ul of Array.from(doc.querySelectorAll('ul[data-checked]'))) {
      let next = ul.nextSibling;
      while (next && next.nodeType === 3 && !next.textContent.trim()) next = next.nextSibling;
      if (next && next.nodeType === 1 && next.matches('ul[data-checked]')) {
        next.prepend(...ul.childNodes);
        ul.remove();
      }
    }
    for (const span of doc.querySelectorAll('.ql-bold')) span.style.fontWeight = 'bold';
    for (const span of doc.querySelectorAll('.ql-italic')) span.style.fontStyle = 'italic';
  }

  // Notion writes to-dos as text: <li>[x]  Send invites</li>. Shared rather
  // than Notion-only, since a paste read through a phone's clipboard can lose
  // the clipboard types that identify Notion.
  function fixTextTasks(doc) {
    for (const li of doc.querySelectorAll('li')) {
      const walker = doc.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      let first = walker.nextNode();
      while (first && !first.textContent.trim()) first = walker.nextNode();
      const match = first && first.textContent.match(/^\s*\[([ xX])\]\s+/);
      if (!match || li.querySelector('input[type="checkbox"]')) continue;
      first.textContent = first.textContent.slice(match[0].length);
      addCheckbox(li, match[1] !== ' ');
    }
  }

  function addCheckbox(li, checked) {
    if (li.querySelector('input[type="checkbox"]')) return;
    const box = li.ownerDocument.createElement('input');
    box.type = 'checkbox';
    if (checked) box.setAttribute('checked', '');
    li.prepend(box);
  }

  // Word writes list items as paragraphs: <p style="mso-list:l0 level2 lfo1">
  // with the bullet or number typed out in a span between <![if !supportLists]>
  // and <![endif]> (comments, once parsed). Rebuild each run of them as a list.
  function fixWordLists(doc) {
    const isItem = (el) => el && el.tagName === 'P' && /mso-list:\s*l\d+\s+level\d+/i.test(el.getAttribute('style') || '');
    for (const first of Array.from(doc.querySelectorAll('p[style*="mso-list"]'))) {
      if (!first.isConnected || !isItem(first) || isItem(first.previousElementSibling)) continue;
      const list = doc.createElement('ul');
      first.before(list);
      let p = first;
      while (isItem(p)) {
        const next = p.nextElementSibling;
        list.append(wordListItem(doc, p));
        p.remove();
        p = next;
      }
    }
  }

  const ROMAN = /^[ivxlc]+$/i; // cspell:disable-line

  function wordListItem(doc, p) {
    const level = parseInt(p.getAttribute('style').match(/level(\d+)/i)[1], 10);
    const marker = takeWordMarker(p);
    const number = marker.match(/^\(?([0-9]+|[a-z]{1,4})[.)]$/i);
    const li = doc.createElement('li');
    li.setAttribute('aria-level', String(level));
    li.setAttribute('data-list-type', number ? 'ol' : 'ul');
    if (number && !/^\d+$/.test(number[1])) {
      const roman = ROMAN.test(number[1]) && number[1] !== 'c';
      const upper = number[1] === number[1].toUpperCase();
      li.style.listStyleType = `${upper ? 'upper' : 'lower'}-${roman ? 'roman' : 'alpha'}`;
    }
    li.append(...p.childNodes);
    return li;
  }

  // Removes the typed-out bullet or number and returns its text ("1.", "·", "o").
  function takeWordMarker(p) {
    let text = '';
    const start = Array.from(p.childNodes).find((n) => n.nodeType === 8 && /^\[if !supportLists\]/.test(n.data));
    if (start) {
      let node = start.nextSibling;
      while (node && !(node.nodeType === 8 && /^\[endif\]/.test(node.data))) {
        const next = node.nextSibling;
        text += node.textContent;
        node.remove();
        node = next;
      }
      if (node) node.remove();
      start.remove();
    }
    for (const span of p.querySelectorAll('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]')) {
      text += span.textContent;
      span.remove();
    }
    return text.replace(/[\s\u00A0]+/g, ' ').trim();
  }

  root.APPS = APPS;
  root.findApp = findApp;
  root.fixHtml = fixHtml;
})(globalThis);

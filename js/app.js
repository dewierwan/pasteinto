// Page wiring: paste anywhere → detect source → convert → preview → auto-copy.
// Switching the output re-converts the last paste and copies again. A PDF file,
// pasted or dropped on the page, is read first and then treated as a paste.
(function () {
  const OUTPUTS = {
    markdown: { noun: 'markdown', hint: 'Claude, ChatGPT, GitHub, Obsidian and Notion' },
    email: { noun: 'email and Slack text', hint: 'Gmail, Outlook, Slack and Teams' },
    rich: { noun: 'rich text', hint: 'Google Docs, Word, Notion and Airtable' },
    whatsapp: { noun: 'WhatsApp text', hint: 'WhatsApp and Signal' },
    plain: { noun: 'plain text', hint: 'LinkedIn, X, text messages and forms' },
  };
  const STORAGE_KEY = 'paste-to.output';
  const APP_SOURCES = ['gdocs', 'notion', 'word', 'gmail', 'airtable', 'slack', 'pdf'];
  // Anonymous usage counts from js/analytics.js; a no-op if it didn't load.
  const track = globalThis.track || (() => {});

  const output = document.getElementById('output');
  const flash = document.getElementById('copyFlash');
  const hint = document.getElementById('outputHint');
  const noun = document.getElementById('outputNoun');
  const sourceHint = document.getElementById('sourceHint');
  const readGroup = document.getElementById('readPills');
  /** @type {HTMLButtonElement[]} */
  const readPills = Array.from(readGroup.querySelectorAll('.pill'));
  /** @type {HTMLButtonElement[]} */
  const pills = Array.from(document.querySelectorAll('[data-output]'));

  /** @type {Output} */
  let current = load() || 'markdown';
  let clip = null; // { html, text, types }
  let detected = null; // { source, read }
  /** @type {ReadAs | null} */
  let readAs = null; // detected.read unless the user picks another "From" option
  let result = null; // the last conversion
  let copyPending = false; // the browser refused the automatic copy; the next tap or click copies
  let reading = 0; // counts PDF files read, so a slow one can't replace a newer paste
  let flashTimer;
  const extension = document.documentElement.classList.contains('is-extension');

  // How to paste on this device. Computers use the keyboard. Phones have no ⌘V
  // and the page has no text field to long-press, so there the card is a button.
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const mac = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
  output.dataset.placeholder = touch ? 'Tap to paste' : `Paste anywhere · ${mac ? '⌘V' : 'Ctrl+V'}`;
  if (touch) {
    output.setAttribute('role', 'button');
    output.setAttribute('aria-label', 'Paste');
  }

  selectOutput(current, false);

  pills.forEach((pill) => {
    pill.addEventListener('click', () => {
      selectOutput(/** @type {Output} */ (pill.dataset.output), true);
      track('format', { format: current, pasted: Boolean(clip) });
    });
  });

  readPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      readAs = /** @type {ReadAs} */ (pill.dataset.read);
      showReadAs();
      render(true);
      // A changed "From" choice suggests detection got this paste wrong.
      track('read_as', { read: readAs, detected: detected ? detected.read : null });
    });
  });

  // Global paste capture: fires whatever is focused. preventDefault stops the
  // browser also pasting into a focused control.
  document.addEventListener('paste', (event) => {
    const data = event.clipboardData;
    if (!data) return;
    // A PDF file copied in Finder or Explorer. Its name comes along as text, so look for the file first.
    const file = Array.from(data.files || []).find(isPdfFile);
    if (file) {
      event.preventDefault();
      takeFile(file, 'keys');
      return;
    }
    // Slack's message box copies its formatting only in its own type.
    const html = data.getData('text/html') || slackToHtml(data.getData(SLACK_TYPE));
    const text = data.getData('text/plain');
    if (!html && !text) return;
    event.preventDefault();
    // The card is only editable as the long-press fallback, so a paste into it came from that menu.
    takeClip({ html, text, types: Array.from(data.types || []) }, output.isContentEditable ? 'menu' : 'keys');
  });

  // Phones only: a tap pastes, or copies if the automatic copy was refused.
  output.addEventListener('click', () => {
    if (!touch || output.isContentEditable) return;
    if (copyPending && result) copyResult(result);
    else pasteFromClipboard();
  });

  // A file dragged over the page: the whole window takes it, and the card shows
  // that it will. Without this the browser would open the file in the tab.
  const draggingFile = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  let dragDepth = 0; // dragenter and dragleave fire for every element crossed
  let idlePlaceholder = null; // the card's usual words, while it says "Drop the PDF"
  const showDrop = (on) => {
    dragDepth = on ? dragDepth : 0;
    document.documentElement.classList.toggle('is-dropping', on);
    if (on && idlePlaceholder === null) {
      idlePlaceholder = output.dataset.placeholder;
      output.dataset.placeholder = 'Drop the PDF';
    } else if (!on && idlePlaceholder !== null) {
      output.dataset.placeholder = idlePlaceholder;
      idlePlaceholder = null;
    }
  };
  document.addEventListener('dragenter', (event) => {
    if (!draggingFile(event)) return;
    dragDepth++;
    showDrop(true);
  });
  document.addEventListener('dragover', (event) => {
    if (!draggingFile(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (event) => {
    if (draggingFile(event) && --dragDepth <= 0) showDrop(false);
  });
  document.addEventListener('drop', (event) => {
    if (!draggingFile(event)) return;
    event.preventDefault();
    showDrop(false);
    const file = Array.from(event.dataTransfer.files).find(isPdfFile);
    if (file) takeFile(file, 'drop');
    else showFlash('Only PDF files', true);
  });

  // A computer whose copy was refused: dropping a file doesn't bring the
  // browser to the front, and a page in the background may not copy. Coming
  // back to the window, or a click in it, copies.
  window.addEventListener('focus', () => {
    if (!touch && copyPending && result) copyResult(result);
  });
  document.addEventListener('click', () => {
    if (!touch && copyPending && result) copyResult(result);
  });

  async function takeFile(file, via) {
    const mine = ++reading;
    showFlash('Reading PDF', false, true);
    let data;
    try {
      data = await readPdfFile(file);
    } catch (err) {
      console.error('Could not read the PDF:', err);
      track('pdf_failed', { reason: (err && err.name) || 'error' });
      if (mine === reading) showFlash(err && err.name === 'PasswordException' ? 'This PDF is locked' : 'Could not read this PDF', true);
      return;
    }
    if (mine !== reading) return;
    if (!data.text.trim()) {
      // A scan: pictures of pages, with no text to read.
      track('pdf_failed', { reason: 'no_text' });
      showFlash('No text in this PDF', true);
      return;
    }
    takeClip(data, via);
  }

  function takeClip(data, via) {
    reading++;
    clip = data;
    detected = detect(clip);
    readAs = detected.read;
    readGroup.removeAttribute('aria-disabled');
    readPills.forEach((p) => {
      p.disabled = false;
    });
    // Name the app when we recognise one; otherwise the selected pill says it all.
    const app = APP_SOURCES.includes(detected.source) ? SOURCE_NAMES[detected.source] : null;
    sourceHint.textContent = app ? `Detected ${app}` : 'Detected automatically';
    // Text copied from a PDF viewer has lost its links; the file still has them.
    // A popup closes when you drag from another window, so there it's paste only.
    if (detected.source === 'pdf' && !clip.pdf && !touch) {
      sourceHint.textContent = `Detected PDF · ${extension ? 'paste' : 'paste or drop'} the file to keep links`;
    }
    output.removeAttribute('contenteditable');
    output.removeAttribute('inputmode');
    showReadAs();
    render(true);
    track('paste', { source: detected.source, format: current, via, file: Boolean(clip.pdf) });
  }

  async function pasteFromClipboard() {
    let data;
    try {
      data = await readClipboard();
    } catch (err) {
      // Not supported, or the person said no to the browser's prompt.
      track('paste_blocked');
      pasteBlocked();
      return;
    }
    if (!data.html && !data.text) {
      showFlash('Nothing to paste', true);
      return;
    }
    takeClip(data, 'tap');
  }

  // Asks for the original HTML: Chrome otherwise strips the attributes that
  // tell Google Docs pastes apart. Browsers that don't know the option ignore it.
  async function readClipboard() {
    const clipboard = navigator.clipboard;
    if (!clipboard) throw new Error('No clipboard access');
    if (!clipboard.read) return { html: '', text: await clipboard.readText(), types: ['text/plain'] };
    const items = await clipboard.read({ unsanitized: ['text/html'] });
    const data = { html: '', text: '', types: [] };
    for (const item of items) {
      for (const type of item.types) {
        if (!data.types.includes(type)) data.types.push(type);
        if (type === 'text/html' && !data.html) data.html = await (await item.getType(type)).text();
        if (type === 'text/plain' && !data.text) data.text = await (await item.getType(type)).text();
      }
    }
    return data;
  }

  // Without clipboard access a phone can still paste from the long-press menu,
  // into the card made editable (inputmode="none" keeps the keyboard away).
  function pasteBlocked() {
    clip = null;
    result = null;
    copyPending = false;
    output.className = 'output-content';
    output.textContent = '';
    output.dataset.placeholder = 'Press and hold here, then tap Paste';
    output.setAttribute('contenteditable', 'true');
    output.setAttribute('inputmode', 'none');
    output.focus();
  }

  function showReadAs() {
    readPills.forEach((p) => p.setAttribute('aria-pressed', String(p.dataset.read === readAs)));
  }

  /** @param {Output} name @param {boolean} copy */
  function selectOutput(name, copy) {
    current = name;
    save(name);
    pills.forEach((p) => p.setAttribute('aria-pressed', String(p.dataset.output === name)));
    hint.textContent = OUTPUTS[name].hint;
    noun.textContent = OUTPUTS[name].noun;
    render(copy);
  }

  function render(copy) {
    if (!clip) return;
    try {
      result = convertClip(clip, readAs, current);
    } catch (err) {
      console.error('Error converting content:', err);
      track('convert_failed', { format: current });
      output.className = 'output-content is-text';
      output.textContent = 'Could not convert this paste.';
      result = null;
      return;
    }
    if (result.html !== undefined) {
      output.className = 'output-content is-rich';
      output.innerHTML = result.html;
    } else {
      output.className = current === 'markdown' ? 'output-content' : 'output-content is-text';
      output.textContent = result.text;
    }
    if (copy) copyResult(result);
  }

  async function copyResult(result) {
    try {
      if (result.html !== undefined) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([result.html], { type: 'text/html' }),
            'text/plain': new Blob([result.text], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(result.text);
      }
      copyPending = false;
      showFlash('Copied', false);
    } catch (err) {
      console.error('Could not copy:', err);
      track('copy_failed', { format: current });
      // Phones (Safari especially) can refuse to copy after reading the
      // clipboard; a fresh tap is allowed to, so ask for one. A computer refuses
      // while the window is in the background, as it is after a file is dropped.
      const wasPending = copyPending;
      copyPending = touch || (!wasPending && !document.hasFocus());
      if (touch) showFlash('Tap to copy', false);
      else if (copyPending) showFlash('Click to copy', false);
      else showFlash('Copy failed', true);
    }
  }

  // stays: the note waits for what comes next ("Reading PDF") instead of fading.
  function showFlash(message, isError, stays = false) {
    flash.textContent = message;
    flash.classList.toggle('is-error', isError);
    flash.style.opacity = '1';
    clearTimeout(flashTimer);
    if (!copyPending && !stays)
      flashTimer = setTimeout(() => {
        flash.style.opacity = '0';
      }, 3000);
  }

  // A remembered output is a convenience; storage can be unavailable.
  /** @returns {Output | null} */
  function load() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return OUTPUTS[value] ? /** @type {Output} */ (value) : null;
    } catch {
      return null;
    }
  }

  function save(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // ignore
    }
  }
})();

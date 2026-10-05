// Page wiring: paste anywhere → detect source → convert → preview → auto-copy.
// Switching the output re-converts the last paste and copies again.
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
  let copyPending = false; // a phone refused the automatic copy; the next tap copies
  let flashTimer;

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

  function takeClip(data, via) {
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
    output.removeAttribute('contenteditable');
    output.removeAttribute('inputmode');
    showReadAs();
    render(true);
    track('paste', { source: detected.source, format: current, via });
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
      // clipboard; a fresh tap is allowed to, so ask for one.
      copyPending = touch;
      if (touch) showFlash('Tap to copy', false);
      else showFlash('Copy failed', true);
    }
  }

  function showFlash(message, isError) {
    flash.textContent = message;
    flash.classList.toggle('is-error', isError);
    flash.style.opacity = '1';
    clearTimeout(flashTimer);
    if (!copyPending)
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

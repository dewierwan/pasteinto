// Saves a real paste as a test fixture: tests/fixtures/<folder>/<name>.html,
// .txt and (if the app adds its own clipboard types) .types. A copy from
// Slack's message box has no HTML, so its Slack data is saved as .slack.json. Then run
// `npm run test:update` and review the expected outputs it writes.
// Usage:
//   npm run capture                      opens a local page to paste into
//   npm run capture -- <folder>/<name>   saves what's on the clipboard now (macOS)
import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFile, execFileSync } from 'child_process';
import { resolve, dirname, join, extname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_NAME = /^[a-z0-9][a-z0-9.-]*$/;
const STANDARD_TYPES = new Set(['text/plain', 'text/html', 'text/rtf', 'text/uri-list', 'Files']);
const TYPES = { '.js': 'text/javascript', '.html': 'text/html' };

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Capture a fixture</title>
<style>body{font:16px system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem}input{font:inherit;padding:.3rem}pre{white-space:pre-wrap;background:#f4f4f4;padding:1rem}</style></head>
<body>
<h1>Capture a fixture</h1>
<p>Copy something in the app you want to test, then paste anywhere on this page.</p>
<p><label>Folder <input id="folder" placeholder="detected after paste"></label>
<label>Name <input id="name" placeholder="e.g. meeting-notes"></label>
<button id="save" disabled>Save</button></p>
<pre id="status">Waiting for a paste…</pre>
<script src="/js/vendor/marked.umd.js"></script>
<script src="/js/util.js"></script>
<script src="/js/from-slack.js"></script>
<script src="/js/sources.js"></script>
<script src="/js/from-pdf.js"></script>
<script src="/js/convert.js"></script>
<script>
let clip;
const status = document.getElementById('status');
document.addEventListener('paste', (event) => {
  if (event.target.tagName === 'INPUT') return;
  event.preventDefault();
  const data = event.clipboardData;
  clip = { html: data.getData('text/html'), text: data.getData('text/plain'), types: Array.from(data.types), slack: data.getData(SLACK_TYPE) };
  const detected = detect({ ...clip, html: clip.html || slackToHtml(clip.slack) });
  if (!document.getElementById('folder').value) document.getElementById('folder').value = detected.source === 'html' ? '' : detected.source;
  document.getElementById('save').disabled = false;
  status.textContent = 'Detected ' + detected.source + ' (read as ' + detected.read + ')\\nTypes: ' + clip.types.join(', ') + '\\n\\n' + (clip.html || clip.slack).slice(0, 2000);
});
document.getElementById('save').addEventListener('click', async () => {
  const body = JSON.stringify({ ...clip, folder: document.getElementById('folder').value.trim(), name: document.getElementById('name').value.trim() });
  const response = await fetch('/save', { method: 'POST', body });
  status.textContent = await response.text();
});
</script>
</body>
</html>`;

function save(body) {
  const { folder, name, html, text, types, slack } = JSON.parse(body);
  if (!SAFE_NAME.test(folder || '') || !SAFE_NAME.test(name || ''))
    return [400, 'Folder and name: lowercase letters, numbers, dots and dashes only.'];
  if (!html && !slack) return [400, 'This paste has no HTML. Plain-text pastes are tested in tests/convert.test.js and tests/pdf.test.js.'];
  const dir = join(root, 'tests', 'fixtures', folder);
  const base = join(dir, name);
  if (existsSync(`${base}.html`) || existsSync(`${base}.slack.json`))
    return [409, `tests/fixtures/${folder}/${name} already exists. Pick another name.`];
  mkdirSync(dir, { recursive: true });
  if (html) writeFileSync(`${base}.html`, html);
  else writeFileSync(`${base}.slack.json`, `${JSON.stringify(JSON.parse(slack), null, 2)}\n`);
  writeFileSync(`${base}.txt`, text || '');
  const ownTypes = (types || []).filter((t) => !STANDARD_TYPES.has(t));
  if (ownTypes.length) writeFileSync(`${base}.types`, `${types.join('\n')}\n`);
  return [
    200,
    `Saved tests/fixtures/${folder}/${name}.${html ? 'html' : 'slack.json'}. Next: npm run test:update, then review the expected files it writes.`,
  ];
}

// The clipboard as a browser's paste event would see it, read with macOS's
// NSPasteboard. Chrome keeps the custom types a page set (Notion's
// text/_notion-blocks-v3-production) in one binary "web custom data" entry.
function readMacClipboard() {
  const script = `ObjC.import('AppKit');
    const pb = $.NSPasteboard.generalPasteboard;
    const str = (t) => { const s = pb.stringForType(t); return s.isNil() ? '' : ObjC.unwrap(s); };
    const custom = pb.dataForType('org.chromium.web-custom-data');
    JSON.stringify({ html: str('public.html'), text: str('public.utf8-plain-text'),
      custom: custom.isNil() ? '' : ObjC.unwrap(custom.base64EncodedStringWithOptions(0)) });`;
  const { html, text, custom } = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf-8' }));
  const customData = readCustomData(Buffer.from(custom, 'base64'));
  const types = [...(text ? ['text/plain'] : []), ...(html ? ['text/html'] : []), ...Object.keys(customData)];
  return { html, text, types, slack: customData['slack/texty'] || '' };
}

// Chromium pickle: uint32 payload size, uint32 count, then count pairs of
// UTF-16 strings (uint32 length in characters, data padded to 4 bytes).
// Returns { type: data }.
function readCustomData(buf) {
  if (buf.length < 8) return {};
  const data = {};
  let at = 8;
  const readString = () => {
    const length = buf.readUInt32LE(at);
    const value = buf.toString('utf16le', at + 4, at + 4 + length * 2);
    at += 4 + Math.ceil((length * 2) / 4) * 4;
    return value;
  };
  for (let i = buf.readUInt32LE(4); i > 0; i--) {
    const type = readString();
    data[type] = readString();
  }
  return data;
}

const target = process.argv[2];
if (target) {
  const [folder, name] = target.split('/');
  const [, message] = save(JSON.stringify({ ...readMacClipboard(), folder, name }));
  console.log(message);
  process.exit(0);
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const [status, message] = save(body);
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
      if (status === 200) console.log(message);
    });
    return;
  }
  const path = req.url.split('?')[0];
  if (path === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE);
  // Only the page's own scripts.
  if (/^\/js\/[a-z/.-]+\.js$/.test(path) && existsSync(join(root, path))) {
    return res.writeHead(200, { 'Content-Type': TYPES[extname(path)] }).end(readFileSync(join(root, path)));
  }
  res.writeHead(404).end();
});

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Paste at ${url} (Ctrl+C to stop)`);
  execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => {});
});

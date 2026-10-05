// Runs every fixture through detection and all five outputs, and compares each
// result with its saved file next to the fixture:
//   <name>.html (+ <name>.txt, <name>.types)  a rich-text paste
//   <name>.txt  (+ <name>-clipboard.html)     a PDF paste (tests/fixtures/pdf)
//   <name>.slack.json (+ .txt, .types)        a copy from Slack's message box
//   <name>.detected.txt                       the detected source and how it is read
//   <name>.expected.md / .email.html / .docs.html / .whatsapp.txt / .plain.txt
// After an intended change, run `npm run test:update` and review the diff.
// Missing expected files are written locally; CI fails instead.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadSite } from './load.js';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const OUTPUTS = { markdown: 'md', email: 'email.html', rich: 'docs.html', whatsapp: 'whatsapp.txt', plain: 'plain.txt' };

let w;
beforeAll(() => {
  w = loadSite();
});

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf-8') : '');

function cases() {
  const found = [];
  for (const folder of readdirSync(fixturesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)) {
    for (const file of readdirSync(join(fixturesDir, folder)).sort()) {
      const base = join(fixturesDir, folder, file.replace(/\.(html|txt)$/, ''));
      if (/\.(expected|detected)\./.test(file)) continue;
      if (file.endsWith('.slack.json')) {
        const slackBase = join(fixturesDir, folder, file.replace(/\.slack\.json$/, ''));
        const clip = {
          slack: read(`${slackBase}.slack.json`),
          text: read(`${slackBase}.txt`),
          types: read(`${slackBase}.types`).split('\n').filter(Boolean),
        };
        found.push({ name: `${folder}/${file.replace(/\.slack\.json$/, '')}`, base: slackBase, clip });
      } else if (folder === 'pdf' ? file.endsWith('.txt') : file.endsWith('.html')) {
        const clip =
          folder === 'pdf'
            ? { text: read(`${base}.txt`), html: read(base.replace(/\.(preview|chrome)$/, '.$1-clipboard') + '.html'), types: [] }
            : { html: read(`${base}.html`), text: read(`${base}.txt`), types: read(`${base}.types`).split('\n').filter(Boolean) };
        found.push({ name: `${folder}/${file.replace(/\.(html|txt)$/, '')}`, base, clip });
      }
    }
  }
  return found;
}

describe.each(cases())('$name', ({ base, clip }) => {
  let detected;
  beforeAll(() => {
    // As the page reads a paste: Slack's data stands in for missing HTML.
    if (clip.slack !== undefined) clip = { html: w.slackToHtml(clip.slack), text: clip.text, types: clip.types };
    detected = w.detect(clip);
  });

  it('detects the source', async () => {
    await expect(`${detected.source} (read as ${detected.read})\n`).toMatchFileSnapshot(`${base}.detected.txt`);
  });

  for (const [output, ext] of Object.entries(OUTPUTS)) {
    it(output, async () => {
      const result = w.convertClip(clip, detected.read, output);
      await expect(`${result.html ?? result.text}\n`).toMatchFileSnapshot(`${base}.expected.${ext}`);
    });
  }
});

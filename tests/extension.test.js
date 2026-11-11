import { it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extensionFiles } from '../scripts/pack-extension.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf-8');

it('packs every file the extension popup needs', () => {
  const files = extensionFiles();
  expect(files).toEqual(
    expect.arrayContaining(['manifest.json', 'index.html', 'css/app.css', 'js/app.js', 'fonts/InterVariable.woff2', 'icons/icon-128.png']),
  );
  // pdf.js is loaded by js/from-pdf-file.js, not by a tag in index.html.
  expect(files).toEqual(expect.arrayContaining(['js/vendor/pdfjs/pdf.min.mjs', 'js/vendor/pdfjs/pdf.worker.min.mjs']));
  expect(files.filter((path) => !existsSync(resolve(root, path)))).toEqual([]);
  expect(files.some((path) => path.startsWith('tests/') || path.startsWith('node_modules/'))).toBe(false);
});

// The Chrome Web Store rejects uploads that break its manifest limits.
it('keeps manifest.json within Chrome Web Store limits', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf-8'));
  expect(manifest.name.length).toBeLessThanOrEqual(75);
  expect(manifest.description.length).toBeLessThanOrEqual(132);
  expect(manifest.action.default_title.length).toBeLessThanOrEqual(75);
});

// Chrome extensions refuse inline scripts, inline event handlers and remote code.
it('keeps index.html loadable as an extension page', () => {
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  expect(html).not.toMatch(/\son[a-z]+="/);
  expect(html).not.toMatch(/<script[^>]+src="https?:/);
});

// A Content-Security-Policy is the backstop if pasted HTML ever reaches the page.
it('sets a Content-Security-Policy that blocks inline scripts', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  expect(csp).not.toBeNull();
  expect(csp[1]).toMatch(/script-src 'self';/);
  expect(csp[1]).not.toMatch(/script-src[^;]*unsafe-inline/);
});

// Loads the site's scripts into a JSDOM window, in the same order as index.html.
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = [
  'js/vendor/marked.umd.js',
  'js/util.js',
  'js/clean-html.js',
  'js/to-markdown.js',
  'js/to-text.js',
  'js/from-pdf.js',
  'js/from-slack.js',
  'js/sources.js',
  'js/convert.js',
];

export function loadSite() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  for (const file of SCRIPTS) dom.window.eval(readFileSync(resolve(root, file), 'utf-8'));
  return dom.window;
}

export function fixture(name) {
  return readFileSync(resolve(root, 'tests', 'fixtures', name), 'utf-8');
}

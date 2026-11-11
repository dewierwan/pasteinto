// Builds the Chrome Web Store upload: dist/pasteinto-extension-<version>.zip.
// The extension is this same site, so the zip holds exactly the files that
// index.html, css/app.css and manifest.json reference, plus the license files.
// Usage: node scripts/pack-extension.mjs
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf-8');

const PDFJS_FILES = ['js/vendor/pdfjs/pdf.min.mjs', 'js/vendor/pdfjs/pdf.worker.min.mjs', 'js/vendor/pdfjs/LICENSE'];

export function extensionFiles() {
  const manifest = JSON.parse(read('manifest.json'));
  const files = new Set(['manifest.json', manifest.action.default_popup, 'LICENSE', 'fonts/LICENSE.md']);
  Object.values(manifest.icons).forEach((path) => files.add(path));
  Object.values(manifest.action.default_icon).forEach((path) => files.add(path));
  // Local href/src references in the page, without the ?v= stamp.
  for (const [, path] of read('index.html').matchAll(/(?:href|src)="(?!https?:|#)([^"?]+)/g)) files.add(path);
  // pdf.js, which js/from-pdf-file.js loads only when a PDF file arrives.
  for (const path of PDFJS_FILES) files.add(path);
  // url() references in the stylesheet, relative to css/.
  for (const [, path] of read('css/app.css').matchAll(/url\('?\.\.\/([^')]+)'?\)/g)) files.add(path);
  return [...files].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(read('manifest.json'));
  const files = extensionFiles();
  const missing = files.filter((path) => !existsSync(resolve(root, path)));
  if (missing.length) {
    console.error(`Missing files: ${missing.join(', ')}`);
    process.exit(1);
  }
  mkdirSync(resolve(root, 'dist'), { recursive: true });
  const zip = join('dist', `pasteinto-extension-${version}.zip`);
  rmSync(resolve(root, zip), { force: true });
  execFileSync('zip', ['-X', '-q', zip, ...files], { cwd: root });
  console.log(`${zip} (${files.length} files)`);
}

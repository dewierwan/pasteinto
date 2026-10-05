import js from '@eslint/js';
import globals from 'globals';

// What each site script adds to globalThis for the scripts after it
// (types/globals.d.ts has their types).
const siteGlobals = Object.fromEntries(
  [
    'marked',
    'escapeHtml',
    'escapeAttr',
    'wrapMarkers',
    'cleanHtml',
    'convertToMarkdown',
    'stripWrappingFence',
    'unescapeOverEscaped',
    'stripImages',
    'toText',
    'pdfToHtml',
    'looksLikePdf',
    'SLACK_TYPE',
    'slackToHtml',
    'APPS',
    'findApp',
    'fixHtml',
    'SOURCE_NAMES',
    'detect',
    'looksLikeMarkdown',
    'convertClip',
    'track',
  ].map((name) => [name, 'readonly']),
);

export default [
  { ignores: ['js/vendor/**', 'dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...siteGlobals } },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', '*.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  {
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  // Snippets pasted into the console of a real app (tests/destinations/README.md).
  {
    files: ['tests/destinations/live/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  // The PDF reader marks bold runs with \u0001 and \u0002 while it works.
  { files: ['js/from-pdf.js'], rules: { 'no-control-regex': 'off' } },
];

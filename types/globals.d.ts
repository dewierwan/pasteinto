// The site's scripts are classic scripts that share functions through
// globalThis, in the order index.html loads them. This declares what each one
// adds, so tsc can check the calls between them.

/** A paste, from the paste event's clipboardData or navigator.clipboard.read(). */
interface Clip {
  html?: string;
  text?: string;
  types?: string[];
  /** Set when the paste is a PDF file: what the file says about its text. */
  pdf?: PdfFormatting;
}

/** A PDF file's printed lines with their font sizes, and its bold and linked runs in reading order. */
interface PdfFormatting {
  lines: { text: string; size: number }[];
  bold: string[];
  links: { text: string; before: string; href: string }[];
}

type ReadAs = 'rich' | 'markdown' | 'text' | 'pdf';
type Output = 'markdown' | 'email' | 'rich' | 'whatsapp' | 'plain';
type Spacing = 'tags' | 'margins';

interface App {
  id: string;
  name: string;
  spacing?: Spacing;
  matches(clip: Required<Pick<Clip, 'html' | 'text' | 'types'>>): boolean;
  fix?(doc: Document): void;
}

interface CleanOptions {
  target?: 'rich' | 'markdown';
  headings?: 'bold' | 'keep';
  tasks?: 'text' | 'inputs';
  spacing?: Spacing;
}

// js/vendor/marked.umd.js
declare var marked: { parse(markdown: string, options?: { gfm?: boolean; breaks?: boolean }): string };

// js/util.js
declare function escapeHtml(s: string): string;
declare function escapeAttr(s: string): string;
declare function wrapMarkers(marker: string, text: string): string;

// js/clean-html.js
declare function cleanHtml(html: string, options?: CleanOptions): string;

// js/to-markdown.js
declare function convertToMarkdown(html: string): string;
declare function stripWrappingFence(markdown: string): string;
declare function unescapeOverEscaped(markdown: string): string;
declare function stripImages(markdown: string): string;

// js/to-text.js
declare function toText(html: string, style: 'whatsapp' | 'plain'): string;

// js/from-pdf.js
declare function pdfToHtml(text: string, html?: string, file?: PdfFormatting): string;
declare function looksLikePdf(text: string): boolean;
declare function keepHyphenForTest(left: string, right: string, text: string): boolean;
declare function pdfListMarker(line: string): { type: string; length: number } | null;

// js/from-pdf-file.js
declare function isPdfFile(file: { type?: string; name?: string } | null | undefined): boolean;
declare function readPdfFile(file: Blob): Promise<Clip>;
declare function readPdfData(lib: any, data: Uint8Array): Promise<Clip>;
declare function pdfPagesToClip(pages: { items: any[]; links: { href: string; rect: number[]; text?: string }[] }[]): Clip;

// js/from-slack.js
declare var SLACK_TYPE: string;
declare function slackToHtml(json: string): string;

// js/sources.js
declare var APPS: App[];
declare function findApp(clip: Clip): App | null;
declare function fixHtml(html: string, app: App | null): string;

// js/convert.js
declare var SOURCE_NAMES: Record<string, string>;
declare function detect(clip: Clip): { source: string; read: ReadAs };
declare function looksLikeMarkdown(text: string): boolean;
declare function convertClip(clip: Clip, readAs: ReadAs, output: Output): { text: string; html?: string };

// Chromium's newer platform API, and its clipboard option to keep the original HTML.
interface Navigator {
  userAgentData?: { platform: string };
}
interface Clipboard {
  read(options?: { unsanitized?: string[] }): Promise<ClipboardItems>;
}

// js/analytics.js
declare function track(name?: string, data?: Record<string, unknown>): void;

/**
 * Turn `dist-single/index.html` into a Claude Artifact page.
 *
 * The artifact host supplies its own `<!doctype html><head></head><body>`
 * skeleton and inlines whatever we hand it, so a complete document would end
 * up nested inside another one. This lifts the parts that matter — the title,
 * the Google Fonts link (the one external host the artifact CSP allows), the
 * inlined stylesheet, the markup and the inlined bundle — into a fragment, in
 * that order.
 *
 * Run after `npm run build:single`:
 *   node scripts/make-artifact.mjs [outputPath]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve('dist-single/index.html');
const target = resolve(process.argv[2] || 'dist-single/artifact.html');

const html = readFileSync(source, 'utf8');

function section(open, close, from = 0) {
  const start = html.indexOf(open, from);
  if (start === -1) return null;
  const end = html.indexOf(close, start);
  if (end === -1) return null;
  return { text: html.slice(start, end + close.length), start, end: end + close.length };
}

const title = section('<title>', '</title>');
const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));

// The font stylesheet, kept verbatim so the exact axes stay the same. Match on
// the `css2?family=` query rather than the host — the two preconnects point at
// the same host and would otherwise win.
const fontLink = head.match(/<link[^>]*css2\?family=[^>]*>/s);

// Everything vite inlined: one <style> and one module <script>.
const styles = [...head.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const scripts = [...head.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);

if (!title) throw new Error('no <title> found in the single-file build');
if (scripts.length === 0) throw new Error('no inlined <script> found — did build:single run?');

const parts = [
  title.text,
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  fontLink ? fontLink[0] : '',
  ...styles,
  // The page owns the full viewport inside the artifact frame.
  '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden}</style>',
  body.trim(),
  ...scripts,
]
  .filter(Boolean)
  .join('\n');

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, parts, 'utf8');

const kb = (parts.length / 1024).toFixed(1);
console.log(`artifact fragment written: ${target} (${kb} kB)`);
console.log(`  title:   ${title.text.replace(/<\/?title>/g, '')}`);
console.log(`  styles:  ${styles.length}`);
console.log(`  scripts: ${scripts.length}`);
console.log(`  fonts:   ${fontLink ? 'linked' : 'MISSING'}`);

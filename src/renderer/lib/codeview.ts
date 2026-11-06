

import { themeColors } from './syntax-theme';
import { highlightBatch } from './syntax-client';
import { CODE_HL_MAX_BYTES, CODE_VIEW_MAX_LINES } from '../../shared/code-preview';

export const HL_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', json: 'json', jsonc: 'jsonc', css: 'css', scss: 'scss',
  less: 'less', html: 'html', htm: 'html', xml: 'xml', svg: 'xml', vue: 'vue',
  md: 'markdown', mdx: 'mdx', markdown: 'markdown', py: 'python', sh: 'shellscript', bash: 'shellscript',
  zsh: 'shellscript', yml: 'yaml', yaml: 'yaml', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', php: 'php', rb: 'ruby', sql: 'sql', toml: 'toml', ini: 'ini',
};
const LEXICAL_LANGS = new Set(Object.values(HL_LANG));

const SEMANTIC_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascriptreact',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescriptreact',
};

export const DIFF_HEADER = /^(diff |index |new file|deleted file|rename |similarity |old mode|new mode|\+\+\+|--- |\\)/;

export function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }) as Record<string, string>)[c]);
}

export function langFor(file: string) {
  return HL_LANG[(file.split('.').pop() || '').toLowerCase()] || null;
}

export function semanticLanguageFor(file: string) {
  return SEMANTIC_LANG[(file.split('.').pop() || '').toLowerCase()] || null;
}

export async function highlightCode(text: string, lang: string | null) {
  if (!lang || !LEXICAL_LANGS.has(lang) || new TextEncoder().encode(text).byteLength >= CODE_HL_MAX_BYTES) return escapeHtml(text);
  return (await highlightBatch([{ text, lang }]))[0].join('\n');
}

export function splitHighlightedLines(html: string) {
  const lines = [];
  const open = [];
  let cur = '';
  const re = /(<[^>]+>)|([^<]+)/g;
  let m = re.exec(html);
  while (m) {
    if (m[1]) {
      cur += m[1];
      if (/^<span/.test(m[1])) open.push(m[1]);
      else if (/^<\/span/.test(m[1])) open.pop();
    } else {
      const parts = m[2].split('\n');
      for (let i = 0; i < parts.length; i++) {
        cur += parts[i];
        if (i < parts.length - 1) {
          cur += '</span>'.repeat(open.length);
          lines.push(cur);
          cur = open.join('');
        }
      }
    }
    m = re.exec(html);
  }
  lines.push(cur);
  return lines;
}

// Build per-line HTML safely for large/unknown files: cap line count and skip the
// (expensive) syntax tokenizer for big files or unknown extensions, so a
// multi-MB dataset can never freeze the renderer.
export function plainCodeLinesFor(text: string) {
  const raw = text.split('\n');
  let shown = raw;
  let extra = 0;
  if (raw.length > CODE_VIEW_MAX_LINES) {
    shown = raw.slice(0, CODE_VIEW_MAX_LINES);
    extra = raw.length - CODE_VIEW_MAX_LINES;
  }
  return { html: shown.map(escapeHtml), shown, extra };
}

export async function codeLinesFor(text: string, lang: string | null) {
  const plain = plainCodeLinesFor(text);
  const slice = plain.extra ? plain.shown.join('\n') : text;
  let html = plain.html;
  if (lang && LEXICAL_LANGS.has(lang) && new TextEncoder().encode(slice).byteLength < CODE_HL_MAX_BYTES) html = (await highlightBatch([{ text: slice, lang }]))[0];
  return { ...plain, html };
}

export interface DiffRow {
  type: 'hunk' | 'add' | 'del' | 'ctx';
  text?: string;
  code?: string;
  oldLn?: number;
  newLn?: number;
  oldStart?: number;
  newStart?: number;
}

export function parseDiffRows(diffText: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLn = 0;
  let newLn = 0;
  const lines = diffText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.startsWith('@@')) {
      const mm = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (mm) {
        oldLn = +mm[1];
        newLn = +mm[2];
        rows.push({ type: 'hunk', text: mm[3].trim(), oldStart: oldLn, newStart: newLn });
      }
      continue;
    }
    if (DIFF_HEADER.test(raw)) continue;
    if (raw === '' && i === lines.length - 1) continue;
    if (raw.startsWith('+')) rows.push({ type: 'add', code: raw.slice(1), newLn: newLn++ });
    else if (raw.startsWith('-')) rows.push({ type: 'del', code: raw.slice(1), oldLn: oldLn++ });
    else rows.push({ type: 'ctx', code: raw.startsWith(' ') ? raw.slice(1) : raw, oldLn: oldLn++, newLn: newLn++ });
  }
  return rows;
}

export function codeRow(type: string, oldLn: number | null | undefined, newLn: number | null | undefined, codeHtml: string) {
  const d = document.createElement('div');
  d.className = `cl ${type}`;
  d.style.setProperty('--code-bg', themeColors['editor.background']);
  d.style.setProperty('--code-fg', themeColors['editor.foreground']);
  d.style.setProperty('--code-ln', themeColors['editorLineNumber.foreground']);
  const o = document.createElement('span');
  o.className = 'ln';
  o.textContent = oldLn == null ? '' : String(oldLn);
  const n = document.createElement('span');
  n.className = 'ln';
  n.textContent = newLn == null ? '' : String(newLn);
  const c = document.createElement('span');
  c.className = 'code';
  c.innerHTML = codeHtml || ' ';
  d.append(o, n, c);
  return d;
}

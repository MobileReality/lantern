import CLOSE_ICON from '@renderer/assets/icons/close.svg';
import { fileLabelHtml } from './file-label';
import type { ProjectFile } from '../../main/filecontent';
import { codeLinesFor, codeRow, langFor, plainCodeLinesFor, semanticLanguageFor } from './codeview';
import { CODE_HL_MAX_BYTES, CODE_VIEW_MAX_LINES } from '../../shared/code-preview';
import { createStepper } from './modalsteps';
import type { StepNav } from './modalsteps';
import { reasonBlock } from './modalreason';
import { findSymbolLine } from './symbolfind';
import { semanticLines } from './semantic-highlight';
import { semanticLimitNotices } from './semantic-limit-notice';
import { isMarkdownPath, renderMarkdown } from '../../shared/markdown-render';
import type { CodeSource, SemanticHighlightResult } from '../../shared/code-highlighting';

type ReadFile = (path: string) => Promise<ProjectFile>;
type ReadSemantic = (path: string, source: CodeSource) => Promise<SemanticHighlightResult>;


let dismissActive: (() => void) | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function notice(text: string) {
  return el('div', 'rv-trunc', text);
}

function truncationNote(file: ProjectFile, extra: number) {
  if (file.clipped) return `File is large: showing only the first ${Math.round(CODE_HL_MAX_BYTES / 1000)} KB.`;
  const dropped = extra + file.truncated;
  return dropped ? `… ${dropped} more lines (showing the first ${CODE_VIEW_MAX_LINES})` : '';
}

function fill(body: HTMLElement, note: HTMLElement, path: string, symbol: string, file: ProjectFile, lexical?: Awaited<ReturnType<typeof codeLinesFor>>, semantic?: SemanticHighlightResult, at?: number) {
  body.textContent = '';
  if (!file.exists) {
    body.appendChild(notice(file.reason ? `File not available: ${file.reason}` : file.refused ? 'This path is outside the project and cannot be shown.' : `File not found on disk: ${path}`));
    return;
  }
  if (file.note) note.textContent = file.note;
  const fallback = lexical ?? plainCodeLinesFor(file.text);
  const shownText = fallback.shown.join('\n');
  const semanticHtml = semantic?.ok && semantic.source.contentHash === file.source?.contentHash ? semanticLines(shownText, semantic.spans, fallback.html, semanticLanguageFor(path)) : null;
  const { shown, extra } = fallback;
  const html = semanticHtml ?? fallback.html;
  const rows = html.map((line, i) => codeRow('ctx', null, i + 1, line));
  body.append(...rows);
  body.prepend(...semanticLimitNotices([semantic]));
  const tail = truncationNote(file, extra);
  if (tail) body.appendChild(notice(tail));
  const line = symbol ? findSymbolLine(shown.join('\n'), symbol) : (at ?? null);
  if (symbol && !line) note.textContent = `Symbol #${symbol} not found in this file`;
  const target = line ? rows[line - 1] : null;
  if (!target) return;
  target.classList.add('target');
  target.scrollIntoView?.({ block: 'center' });
}

function fillMarkdown(body: HTMLElement, text: string) {
  const page = el('div', 'lt-md');
  page.innerHTML = renderMarkdown(text);
  page.querySelectorAll('a').forEach((a) => { a.addEventListener('click', (ev) => ev.preventDefault()); });
  body.textContent = '';
  body.appendChild(page);
}

interface CodeView {
  body: HTMLElement;
  note: HTMLElement;
  toggle: HTMLButtonElement;
  load(path: string, symbol: string, at?: number): void;
}

function createCodeView(read: ReadFile, readSemantic?: ReadSemantic, markdownToggle = false): CodeView {
  const note = el('span', 'lt-code-note');
  const toggle = el('button', 'lt-md-toggle', 'Rendered');
  toggle.type = 'button';
  toggle.hidden = true;
  const body = el('div', 'rv-code lt-code-body');
  let ticket = 0;
  let rendered = false;
  let paint: (() => void) | null = null;

  function load(path: string, sym: string, at?: number) {
    note.textContent = '';
    rendered = false;
    paint = null;
    toggle.hidden = true;
    toggle.textContent = 'Rendered';
    toggle.setAttribute('aria-pressed', 'false');
    body.textContent = '';
    body.appendChild(notice('Loading…'));
    body.scrollTop = 0;
    const mine = ++ticket;
    read(path).then(
      (res) => {
        if (!body.isConnected || mine !== ticket) return;
        let lexical: Awaited<ReturnType<typeof codeLinesFor>> | undefined;
        let semantic: SemanticHighlightResult | undefined;
        const repaint = () => {
          if (!body.isConnected || mine !== ticket) return;
          const scroll = body.scrollTop;
          if (rendered) fillMarkdown(body, res.text);
          else fill(body, note, path, sym, res, lexical, semantic, at);
          body.scrollTop = scroll;
        };
        paint = repaint;
        toggle.hidden = !(markdownToggle && res.exists && isMarkdownPath(path));
        fill(body, note, path, sym, res, undefined, undefined, at);
        if (!sym && !at) body.scrollTop = 0;
        void codeLinesFor(res.text, langFor(path)).then((result) => { lexical = result; repaint(); });
        if (res.source && readSemantic) void readSemantic(path, res.source).then((result) => {
          if (!body.isConnected || mine !== ticket || result.source.contentHash !== res.source?.contentHash) return;
          semantic = result;
          repaint();
        }, () => {});
      },
      () => {
        if (!body.isConnected || mine !== ticket) return;
        body.textContent = '';
        body.appendChild(notice('Could not read this file.'));
      },
    );
  }

  toggle.addEventListener('click', () => {
    rendered = !rendered;
    toggle.textContent = rendered ? 'Raw' : 'Rendered';
    toggle.setAttribute('aria-pressed', String(rendered));
    paint?.();
  });
  return { body, note, toggle, load };
}

function openCodeModal(host: HTMLElement, read: ReadFile, path: string, symbol: string, reason?: string, nav?: StepNav, readSemantic?: ReadSemantic, markdownToggle = false, at?: number) {
  dismissActive?.();
  const opener = document.activeElement as HTMLElement | null;
  const modal = el('div', 'modal lt-code-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const card = el('div', 'modal-card lt-code-card');
  const head = el('div', 'modal-head');
  const title = el('span', 'modal-title lt-code-path');
  const close = el('button', 'modal-close');
  close.dataset.tip = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close code');
  close.innerHTML = CLOSE_ICON;
  const stepper = nav ? createStepper(nav, (index) => show(index, ''), () => close.focus()) : null;
  const view = createCodeView(read, readSemantic, markdownToggle);
  head.append(title, view.note, view.toggle);
  if (stepper) head.append(stepper.el);
  head.append(close);
  card.append(head, view.body);
  modal.appendChild(card);
  let reasonEl: HTMLElement | null = null;

  function show(index: number, sym: string, line?: number) {
    const file = nav ? nav.files[index] : { path, reason };
    stepper?.update(index);
    title.dataset.tip = file.path;
    title.innerHTML = fileLabelHtml(file.path);
    if (sym) title.append(document.createTextNode(' '), el('span', 'sym', `#${sym}`));
    modal.setAttribute('aria-label', `Code of ${file.path}`);
    reasonEl?.remove();
    reasonEl = reasonBlock(file.reason);
    if (reasonEl) head.after(reasonEl);
    view.load(file.path, sym, line);
  }

  function dismiss() {
    window.removeEventListener('keydown', onKey, true);
    if (dismissActive === dismiss) dismissActive = null;
    modal.remove();
    if (opener?.isConnected) opener.focus();
  }
  function onKey(ev: KeyboardEvent) {
    if (!modal.isConnected) {
      if (ev.key === 'Escape') dismiss();
      return;
    }
    if (stepper?.handleKey(ev)) return;
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    dismiss();
  }
  dismissActive = dismiss;
  window.addEventListener('keydown', onKey, true);
  close.addEventListener('click', dismiss);
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) dismiss();
  });
  host.appendChild(modal);
  close.focus();
  show(nav ? nav.index : 0, symbol, at);
}

export { createCodeView, openCodeModal };
export type { CodeView, ReadFile };

import type { SemanticSpan } from '../../shared/code-highlighting';
import { escapeHtml } from './codeview';
import { semanticStyle } from './syntax-theme';

type Styles = Record<string, string>;

function lexicalStyles(html: string, length: number) {
  const host = document.createElement('div');
  host.innerHTML = html;
  const styles: Styles[] = Array.from({ length }, () => ({}));
  let at = 0;
  const walk = (node: Node, inherited: Styles) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const size = node.textContent?.length ?? 0;
      for (let i = at; i < Math.min(at + size, length); i++) styles[i] = inherited;
      at += size;
      return;
    }
    const next = { ...inherited };
    if (node instanceof HTMLElement) for (const name of node.style) next[name] = node.style.getPropertyValue(name);
    node.childNodes.forEach((child) => { walk(child, next); });
  };
  host.childNodes.forEach((node) => { walk(node, {}); });
  return styles;
}

function applySemanticStyle(lexical: Styles, semantic: ReturnType<typeof semanticStyle>) {
  if (!semantic) return { style: lexical, applied: false };
  const merged = { ...lexical };
  if (semantic.foreground) merged.color = semantic.foreground;
  if (semantic.italic !== undefined) {
    if (semantic.italic) merged['font-style'] = 'italic';
    else delete merged['font-style'];
  }
  if (semantic.bold !== undefined) {
    if (semantic.bold) merged['font-weight'] = 'bold';
    else delete merged['font-weight'];
  }
  if (semantic.underline !== undefined || semantic.strikethrough !== undefined) {
    const current = new Set((merged['text-decoration'] ?? '').split(/\s+/).filter(Boolean));
    if (semantic.underline !== undefined) semantic.underline ? current.add('underline') : current.delete('underline');
    if (semantic.strikethrough !== undefined) semantic.strikethrough ? current.add('line-through') : current.delete('line-through');
    if (current.size) merged['text-decoration'] = [...current].join(' ');
    else delete merged['text-decoration'];
  }
  return { style: merged, applied: true };
}

function styleAttribute(style: Styles) {
  const value = Object.entries(style).map(([name, setting]) => `${name}:${setting}`).join(';');
  return value ? ` style="${value}"` : '';
}

function semanticLines(text: string, spans: SemanticSpan[], lexicalHtml?: string[], language: string | null = null) {
  const lines = text.split('\n');
  const byLine = new Map<number, SemanticSpan[]>();
  for (const span of spans) {
    const list = byLine.get(span.line) ?? [];
    list.push(span);
    byLine.set(span.line, list);
  }
  return lines.map((line, lineIndex) => {
    const tokens = (byLine.get(lineIndex) ?? []).sort((a, b) => a.start - b.start);
    const styles = lexicalHtml?.[lineIndex] ? lexicalStyles(lexicalHtml[lineIndex], line.length) : Array.from<Styles>({ length: line.length }).fill({});
    const semantic: boolean[] = Array(line.length).fill(false);
    let tokenEnd = 0;
    for (const token of tokens) {
      if (token.start < tokenEnd || token.start < 0 || token.length <= 0) continue;
      tokenEnd = Math.min(token.start + token.length, line.length);
      const tokenStyle = semanticStyle(token.type, token.modifiers, language);
      for (let at = token.start; at < tokenEnd; at++) {
        const applied = applySemanticStyle(styles[at], tokenStyle);
        styles[at] = applied.style;
        semantic[at] = applied.applied;
      }
    }
    let at = 0;
    let html = '';
    while (at < line.length) {
      let end = at + 1;
      const signature = JSON.stringify(styles[at]);
      while (end < line.length && JSON.stringify(styles[end]) === signature && semantic[end] === semantic[at]) end++;
      const content = escapeHtml(line.slice(at, end));
      html += Object.keys(styles[at]).length || semantic[at] ? `<span${styleAttribute(styles[at])}${semantic[at] ? ' data-semantic="true"' : ''}>${content}</span>` : content;
      at = end;
    }
    return html;
  });
}

function semanticLine(text: string, spans: SemanticSpan[], lexicalHtml?: string, language: string | null = null) {
  return semanticLines(text, spans.map((span) => ({ ...span, line: 0 })), lexicalHtml ? [lexicalHtml] : undefined, language)[0];
}

export { semanticLine, semanticLines };

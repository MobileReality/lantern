import { Marked } from 'marked';
import type { Tokens } from 'marked';

const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;
const SAFE_LINK = /^(https?:|mailto:|#)/i;

function isMarkdownPath(path: string) {
  return MARKDOWN_EXTENSION.test(path);
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const parser = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      if (!SAFE_LINK.test(token.href.trim())) return inner;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<a href="${escapeHtml(token.href.trim())}"${title} rel="noopener noreferrer">${inner}</a>`;
    },
    image(token: Tokens.Image) {
      return escapeHtml(token.text);
    },
  },
});

function renderMarkdown(source: string) {
  return parser.parse(source, { async: false });
}

export { isMarkdownPath, renderMarkdown };

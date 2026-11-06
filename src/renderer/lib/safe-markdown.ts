import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function safeMarkdown(md: string) {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

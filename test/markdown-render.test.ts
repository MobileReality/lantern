import { describe, expect, it } from 'vitest';
import { isMarkdownPath, renderMarkdown } from '../src/shared/markdown-render';

describe('isMarkdownPath', () => {
  it('matches .md and .markdown only', () => {
    expect(isMarkdownPath('docs/README.md')).toBe(true);
    expect(isMarkdownPath('a/NOTES.MARKDOWN')).toBe(true);
    expect(isMarkdownPath('src/a.ts')).toBe(false);
    expect(isMarkdownPath('md')).toBe(false);
    expect(isMarkdownPath('a.md.bak')).toBe(false);
  });
});

describe('renderMarkdown', () => {
  it('renders headings', () => {
    const html = renderMarkdown('# Title\n\n## Sub');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h2>Sub</h2>');
  });

  it('renders lists', () => {
    const html = renderMarkdown('- one\n- two\n\n1. first\n2. second');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>second</li>');
  });

  it('renders fenced code', () => {
    const html = renderMarkdown('```ts\nconst a = 1 < 2;\n```');
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('const a = 1 &lt; 2;');
  });

  it('renders a safe link', () => {
    const html = renderMarkdown('[site](https://example.com/x)');
    expect(html).toContain('<a href="https://example.com/x"');
    expect(html).toContain('>site</a>');
  });

  it('drops a script payload', () => {
    const html = renderMarkdown('hi\n\n<script>alert(1)</script>\n\ntext <img src=x onerror=alert(2)> end');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not keep a javascript: link live', () => {
    const html = renderMarkdown('[bad](javascript:alert(1))');
    expect(html).not.toMatch(/href=/i);
    expect(html).toContain('bad');
  });

  it('does not emit images', () => {
    expect(renderMarkdown('![alt](https://example.com/a.png)')).not.toMatch(/<img/i);
  });
});

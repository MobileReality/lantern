// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { safeMarkdown } from '../src/renderer/lib/safe-markdown';

describe('safeMarkdown', () => {
  it('removes script tags and event handlers', () => {
    const div = document.createElement('div');
    div.innerHTML = safeMarkdown('hi <script>alert(1)</script> <img src=x onerror="alert(2)"> **bold**');
    expect(div.querySelector('script')).toBeNull();
    expect(div.querySelector('img')?.hasAttribute('onerror') ?? false).toBe(false);
    expect(div.querySelector('strong')?.textContent).toBe('bold');
  });

  it('removes javascript: links', () => {
    expect(safeMarkdown('[x](javascript:alert(1))')).not.toMatch(/javascript:/i);
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { codeLinesFor, codeRow, highlightCode } from '../src/renderer/lib/codeview';
import { CODE_HL_MAX_BYTES, CODE_VIEW_MAX_LINES } from '../src/shared/code-preview';
import { byId, footBtn } from '../src/renderer/lib/util';

describe('byId', () => {
  it('returns the element when present', () => {
    const el = document.createElement('div');
    el.id = 'target';
    document.body.appendChild(el);
    expect(byId('target')).toBe(el);
  });

  it('throws a descriptive error when the element is missing', () => {
    expect(() => byId('does-not-exist')).toThrow(/does-not-exist/);
  });
});

describe('footBtn', () => {
  it('builds a button with label, class and a click handler', () => {
    const onClick = vi.fn();
    const b = footBtn('Save', onClick, 'primary');
    expect(b.tagName).toBe('BUTTON');
    expect(b.textContent).toBe('Save');
    expect(b.className).toBe('primary');
    b.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('codeRow', () => {
  it('renders both gutter numbers and the code cell', () => {
    const row = codeRow('add', null, 42, '<span>x</span>');
    const [oldLn, newLn, code] = [...row.children] as HTMLElement[];
    expect(row.className).toBe('cl add');
    expect(oldLn.textContent).toBe('');
    expect(newLn.textContent).toBe('42');
    expect(code.innerHTML).toBe('<span>x</span>');
  });

  it('falls back to a non-empty code cell so the row keeps its height', () => {
    const row = codeRow('ctx', 1, 1, '');
    const code = row.children[2] as HTMLElement;
    expect(code.innerHTML).toBe(' ');
  });
});

describe('highlightCode', () => {
  it('uses a real grammar and keeps source HTML inert', async () => {
    const html = await highlightCode('<img src=x onerror=alert(1)>', 'typescript');
    expect(html).toContain('&lt;');
    expect(html).not.toContain('<img');
  });

  it('escapes and returns plain text for an unknown language', async () => {
    expect(await highlightCode('<x>', 'unknown')).toBe('&lt;x&gt;');
  });

  it('falls back safely before tokenizing a huge single line', async () => {
    const html = await highlightCode(`<${'x'.repeat(CODE_HL_MAX_BYTES)}>`, 'typescript');
    expect(html.startsWith('&lt;')).toBe(true);
    expect(html).not.toContain('<span');
  });
});

describe('codeLinesFor', () => {
  it('escapes each line when no grammar is available', async () => {
    const { html, extra } = await codeLinesFor('<a>\n<b>', null);
    expect(html).toEqual(['&lt;a&gt;', '&lt;b&gt;']);
    expect(extra).toBe(0);
  });

  it('caps very large files and reports the dropped line count', async () => {
    const text = Array.from({ length: CODE_VIEW_MAX_LINES + 50 }, (_, i) => `line ${i}`).join('\n');
    const { html, extra } = await codeLinesFor(text, null);
    expect(html).toHaveLength(CODE_VIEW_MAX_LINES);
    expect(extra).toBe(50);
  });
});

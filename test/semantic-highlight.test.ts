// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { decode } from '../src/main/lsp/semantic-service';
import { semanticLines } from '../src/renderer/lib/semantic-highlight';
import { resolveSemanticStyle } from '../src/renderer/lib/syntax-theme';

describe('semantic highlighting', () => {
  it('decodes relative LSP positions and modifiers', () => {
    expect(decode([0, 6, 4, 0, 1, 1, 2, 3, 1, 0], ['class', 'property'], ['declaration'])).toEqual([
      { line: 0, start: 6, length: 4, type: 'class', modifiers: ['declaration'] },
      { line: 1, start: 2, length: 3, type: 'property', modifiers: [] },
    ]);
  });

  it('uses UTF-16 offsets without corrupting astral Unicode', () => {
    const html = semanticLines('😀 value', [{ line: 0, start: 3, length: 5, type: 'variable', modifiers: [] }]);
    expect(html).toEqual(['😀 <span style="color:#F6F8F9" data-semantic="true">value</span>']);
  });

  it('merges modifier font style with the token type color and honors language selectors', () => {
    const lexical = ['<span style="color:#123456;font-style:italic">value</span>'];
    const html = semanticLines('value', [{ line: 0, start: 0, length: 5, type: 'variable', modifiers: ['declaration'] }], lexical, 'typescript')[0];
    expect(html).toContain('color:#E2E8F0');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('font-weight:bold');
  });

  it('keeps lexical styles for unknown semantic token types', () => {
    const html = semanticLines('value', [{ line: 0, start: 0, length: 5, type: 'futureToken', modifiers: [] }], ['<span style="color:#123456;font-style:italic">value</span>']);
    expect(html[0]).toContain('color:rgb(18, 52, 86)');
    expect(html[0]).toContain('font-style:italic');
    expect(html[0]).not.toContain('data-semantic');
  });

  it('resolves semantic properties independently and supports boolean resets', () => {
    const theme = { semanticHighlighting: true, semanticTokenColors: {
      variable: { foreground: '#111111', italic: true, underline: true },
      '*.declaration': { bold: true, italic: false },
      '*.deprecated': { strikethrough: true },
    } };
    expect(resolveSemanticStyle(theme, 'variable', ['declaration', 'deprecated'], null)).toEqual({ foreground: '#111111', italic: false, underline: true, bold: true, strikethrough: true });
  });

  it('lets fontStyle reset all four flags and honors disabled semantic highlighting', () => {
    const enabled = { semanticHighlighting: true, semanticTokenColors: { variable: { bold: true, italic: true }, 'variable.documentation': { fontStyle: '' } } };
    expect(resolveSemanticStyle(enabled, 'variable', ['documentation'], null)).toMatchObject({ bold: false, italic: false, underline: false, strikethrough: false });
    expect(resolveSemanticStyle({ ...enabled, semanticHighlighting: false }, 'variable', ['documentation'], null)).toBeNull();
  });

  it('uses VS Code language identifiers for JSX and TSX qualifiers', () => {
    const theme = { semanticHighlighting: true, semanticTokenColors: { variable: '#111111', 'variable:typescriptreact': '#222222', 'variable:javascriptreact': '#333333' } };
    expect(resolveSemanticStyle(theme, 'variable', [], 'typescriptreact')?.foreground).toBe('#222222');
    expect(resolveSemanticStyle(theme, 'variable', [], 'javascriptreact')?.foreground).toBe('#333333');
  });

  it('escapes source text and ignores overlapping stale spans', () => {
    const html = semanticLines('<one>', [
      { line: 0, start: 1, length: 3, type: 'property', modifiers: [] },
      { line: 0, start: 2, length: 2, type: 'class', modifiers: [] },
    ]);
    expect(html[0]).toContain('&lt;');
    expect(html[0].match(/data-semantic/g)).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  langFor,
  parseDiffRows,
  splitHighlightedLines,
  HL_LANG,
  semanticLanguageFor,
} from '../src/renderer/lib/codeview';

describe('escapeHtml', () => {
  it('escapes the three html-significant characters', () => {
    expect(escapeHtml('<a> & </a>')).toBe('&lt;a&gt; &amp; &lt;/a&gt;');
  });

  it('leaves quotes and ordinary text alone', () => {
    expect(escapeHtml('const x = "y";')).toBe('const x = "y";');
  });
});

describe('semanticLanguageFor', () => {
  it('uses language server identifiers for JSX and TSX', () => {
    expect(semanticLanguageFor('component.tsx')).toBe('typescriptreact');
    expect(semanticLanguageFor('component.jsx')).toBe('javascriptreact');
    expect(semanticLanguageFor('config.jsonc')).toBeNull();
  });
});

describe('langFor', () => {
  it('maps known extensions to their TextMate grammars', () => {
    expect(langFor('a/b/file.tsx')).toBe('tsx');
    expect(langFor('a/b/file.jsx')).toBe('jsx');
    expect(langFor('tsconfig.jsonc')).toBe('jsonc');
    expect(langFor('script.py')).toBe('python');
    expect(langFor('Component.vue')).toBe('vue');
  });

  it('is case-insensitive on the extension', () => {
    expect(langFor('FILE.TS')).toBe('typescript');
  });

  it('returns null for unknown or extensionless files', () => {
    expect(langFor('data.unknownext')).toBeNull();
    expect(langFor('Makefile')).toBeNull();
  });
});

describe('markdown files', () => {
  it('are read as markdown, skill files included', () => {
    expect(langFor('skills/deploy/SKILL.md')).toBe('markdown');
    expect(langFor('CLAUDE.md')).toBe('markdown');
    expect(langFor('docs/page.mdx')).toBe('mdx');
  });

  it('have a markdown grammar in the bundled highlighter', async () => {
    const lines = (await import('../src/renderer/lib/syntax-highlighting')).highlightLines('# Title\n\nRead [the protocol](protocol.md) and `run` it.\n', 'markdown');
    expect(lines[0]).toContain('font-weight:bold');
    expect(lines[2]).toContain('color:');
    expect(lines.join('')).toContain('run');
  });
});

describe('bundled grammars', () => {
  it('tokenizes a smoke sample with every registered language using the JavaScript engine', async () => {
    const { highlightLines } = await import('../src/renderer/lib/syntax-highlighting');
    for (const language of new Set(Object.values(HL_LANG))) {
      expect(() => highlightLines('const value = "safe";\n# heading\n', language), language).not.toThrow();
    }
  });
});

describe('splitHighlightedLines', () => {
  it('splits plain text on newlines', () => {
    expect(splitHighlightedLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('reopens spans that straddle a newline so each line is valid html', () => {
    const lines = splitHighlightedLines('<span class="k">foo\nbar</span>');
    expect(lines).toEqual(['<span class="k">foo</span>', '<span class="k">bar</span>']);
  });
});

describe('parseDiffRows', () => {
  const diff = [
    'diff --git a/x.ts b/x.ts',
    'index 111..222 100644',
    '--- a/x.ts',
    '+++ b/x.ts',
    '@@ -1,2 +1,2 @@ header text',
    ' kept',
    '-removed',
    '+added',
  ].join('\n');

  it('drops diff/index/+++/--- header noise', () => {
    const rows = parseDiffRows(diff);
    expect(rows.some((r) => r.type === 'add' && r.code === ' a/x.ts b/x.ts')).toBe(false);
  });

  it('emits a hunk row carrying the trailing header text', () => {
    const rows = parseDiffRows(diff);
    expect(rows[0]).toEqual({ type: 'hunk', text: 'header text', oldStart: 1, newStart: 1 });
  });

  it('does not turn the newline that ends git output into a context row', () => {
    const rows = parseDiffRows(`${diff}\n`);
    expect(rows.filter((r) => r.type !== 'hunk')).toHaveLength(3);
  });

  it('numbers context, deletion and addition rows correctly', () => {
    const rows = parseDiffRows(diff).filter((r) => r.type !== 'hunk');
    expect(rows).toEqual([
      { type: 'ctx', code: 'kept', oldLn: 1, newLn: 1 },
      { type: 'del', code: 'removed', oldLn: 2 },
      { type: 'add', code: 'added', newLn: 2 },
    ]);
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createReviewPane } from '../src/renderer/lib/lanternreview';

describe('review pane reloads', () => {
  it('fetches the file again when its version moves, and not otherwise', () => {
    const readDiff = vi.fn(() => new Promise<never>(() => {}));
    const pane = createReviewPane({ readDiff, onStep: vi.fn() });
    pane.prefer('diff');
    pane.show({ pr: 'local:cmp:main|@', path: 'src/a.ts', version: 'v1' });
    pane.show({ pr: 'local:cmp:main|@', path: 'src/a.ts', version: 'v1' });
    expect(readDiff).toHaveBeenCalledTimes(1);
    pane.show({ pr: 'local:cmp:main|@', path: 'src/a.ts', version: 'v2' });
    expect(readDiff).toHaveBeenCalledTimes(2);
    expect(readDiff).toHaveBeenLastCalledWith('local:cmp:main|@', 'src/a.ts');
  });

  it('names a local comparison by its title, never by its raw id', () => {
    const pane = createReviewPane({ readDiff: vi.fn(() => new Promise<never>(() => {})), onStep: vi.fn() });
    pane.show({ pr: 'local:cmp:origin/main|@', path: 'src/a.ts' });
    expect(pane.el.querySelector('.sym')).toBeNull();
    expect(pane.el.querySelector('.lt-code-path')?.textContent).not.toContain('local:cmp');
    expect(pane.el.getAttribute('aria-label')).toBe('Diff of src/a.ts in local comparison origin/main → working tree');
    pane.show({ pr: '12', path: 'src/a.ts' });
    expect(pane.el.querySelector('.sym')?.textContent).toBe('#12');
  });
});

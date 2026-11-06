// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrExplainSections, PrExplanation } from '../src/shared/pr-explain';
import { PR_EXPLAIN_NEW_FILE_BEFORE } from '../src/shared/pr-explain';
import { createExplainHub } from '../src/renderer/lib/prexplain';
import type { ExplainHub, PrExplainClient } from '../src/renderer/lib/prexplain';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const HEAD = 'a'.repeat(40);
const TARGET = { pr: '24', path: 'test/new-a.ts', head: HEAD };
const flush = () => new Promise((r) => setTimeout(r, 0));

const SECTIONS: PrExplainSections = {
  summary: 'It refuses a negative pid. That keeps kill() safe.',
  before: 'Any number reached kill().',
  after: 'A negative number is refused.',
  example: 'kill(-1) -> refused',
};

function explanation(overrides: Partial<PrExplanation> = {}): PrExplanation {
  return { text: 'plain', head: HEAD, at: 1, stale: false, ...overrides };
}

function client(saved: PrExplanation | null): PrExplainClient {
  return {
    saved: vi.fn(async () => ({ ok: true as const, explanation: saved })),
    start: vi.fn(async () => ({ ok: true as const })),
    cancel: vi.fn(async () => true),
    onDone: () => () => {},
  };
}

let hub: ExplainHub | undefined;
const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  hub?.dispose();
  hub = undefined;
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
});

async function open(saved: PrExplanation | null, options?: Parameters<typeof createExplainHub>[1], target = TARGET) {
  hub = createExplainHub(client(saved), { enabled: true, ...options });
  const row = hub.row(target);
  document.body.append(row);
  await flush();
  return row;
}

const sec = (row: HTMLElement, key: string) => row.querySelector(`[data-section="${key}"]`) as HTMLElement | null;
const toggle = (row: HTMLElement) => row.querySelector('button[data-explain-toggle]') as HTMLButtonElement;
const body = (row: HTMLElement) => row.querySelector('.lt-explain-body') as HTMLElement;

describe('the four sections', () => {
  it('shows What changes, Before, After and Example as separate labelled sections', async () => {
    const row = await open(explanation({ sections: SECTIONS }));
    const labels = [...row.querySelectorAll('.lt-explain-label')].map((l) => l.textContent);
    expect(labels).toEqual(['What changes', 'Before', 'After', 'Example']);
    expect(sec(row, 'summary')?.textContent).toContain('It refuses a negative pid.');
    expect(sec(row, 'before')?.textContent).toContain('Any number reached kill().');
    expect((row.querySelector('.lt-explain-text') as HTMLElement).hidden).toBe(true);
  });

  it('shows a new file Before as the file being new', async () => {
    const row = await open(explanation({ sections: { ...SECTIONS, before: PR_EXPLAIN_NEW_FILE_BEFORE } }));
    expect(sec(row, 'before')?.textContent).toBe(`Before${PR_EXPLAIN_NEW_FILE_BEFORE}`);
    expect(sec(row, 'before')?.textContent).toContain('new');
  });

  it('sets an example that looks like input and output in a monospace block, and prose as a paragraph', async () => {
    const row = await open(explanation({ sections: SECTIONS }));
    expect(sec(row, 'example')?.querySelector('pre.lt-explain-code')?.textContent).toBe('kill(-1) -> refused');
    expect(sec(row, 'summary')?.querySelector('pre')).toBeNull();

    document.body.textContent = '';
    hub?.dispose();
    const prose = await open(explanation({ sections: { ...SECTIONS, example: 'Pressing the button twice only saves once' } }));
    expect(sec(prose, 'example')?.querySelector('pre')).toBeNull();
  });

  it('renders every section with textContent, never as HTML', async () => {
    const evil = '<img src=x onerror=alert(1)><b>bold</b>';
    const row = await open(explanation({ sections: { summary: evil, before: evil, after: evil, example: evil } }));
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('b')).toBeNull();
    expect(sec(row, 'after')?.querySelector('p')?.textContent).toBe(evil);
    expect(sec(row, 'example')?.querySelector('pre')?.textContent).toBe(evil);
  });

  it('still renders an explanation saved before the change as one block', async () => {
    const row = await open(explanation({ text: 'An old explanation.' }));
    const text = row.querySelector('.lt-explain-text') as HTMLElement;
    expect(text.hidden).toBe(false);
    expect(text.textContent).toBe('An old explanation.');
    expect(row.querySelectorAll('.lt-explain-sec')).toHaveLength(0);
  });

  it('falls back to the plain block, not a broken panel, when the reply was not structured', async () => {
    const row = await open(explanation({ text: '{"summary": "cut off' }));
    expect((row.querySelector('.lt-explain-text') as HTMLElement).textContent).toBe('{"summary": "cut off');
    expect([...row.querySelectorAll('button[data-explain]')].map((b) => b.textContent)).toEqual(['Regenerate', 'Copy']);
  });

  it('keeps Regenerate and copies all sections as plain text with headings', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const row = await open(explanation({ sections: SECTIONS }));
    expect([...row.querySelectorAll('button[data-explain]')].map((b) => b.textContent)).toEqual(['Regenerate', 'Copy']);
    (row.querySelector('button[data-explain="copy"]') as HTMLButtonElement).click();
    expect(writeText).toHaveBeenCalledWith(
      'What changes\nIt refuses a negative pid. That keeps kill() safe.\n\nBefore\nAny number reached kill().\n\nAfter\nA negative number is refused.\n\nExample\nkill(-1) -> refused',
    );
  });
});

describe('the collapse control', () => {
  it('is a keyboard-operable button with aria-expanded that hides and shows the body', async () => {
    const row = await open(explanation({ sections: SECTIONS }));
    const control = toggle(row);
    expect(control.tagName).toBe('BUTTON');
    expect(control.type).toBe('button');
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(control.getAttribute('aria-controls')).toBe(body(row).id);
    control.click();
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(body(row).hidden).toBe(true);
    expect(row.classList.contains('lt-explain-collapsed')).toBe(true);
    control.click();
    expect(body(row).hidden).toBe(false);
    expect(row.classList.contains('lt-explain-collapsed')).toBe(false);
  });

  it('still shows that an explanation exists, and its stale marker, while collapsed', async () => {
    const row = await open(explanation({ sections: SECTIONS, stale: true, head: 'b'.repeat(40) }));
    toggle(row).click();
    expect(body(row).hidden).toBe(true);
    const state = row.querySelector('.lt-explain-state') as HTMLElement;
    expect(state.textContent).toBe('Ready');
    const stale = row.querySelector('.lt-explain-stale') as HTMLElement;
    expect(stale.hidden).toBe(false);
    expect(stale.closest('.lt-explain-body')).toBeNull();
  });

  it('shows nothing about an explanation when there is none', async () => {
    const row = await open(null);
    toggle(row).click();
    expect((row.querySelector('.lt-explain-state') as HTMLElement).textContent).toBe('');
  });

  it('stays collapsed when the review moves to another file', async () => {
    const row = await open(null);
    toggle(row).click();
    const other = hub!.row({ ...TARGET, path: 'test/new-b.ts' });
    expect(other).not.toBe(row);
    expect(body(other).hidden).toBe(true);
    expect(toggle(other).getAttribute('aria-expanded')).toBe('false');
    toggle(other).click();
    expect(body(hub!.row(TARGET)).hidden).toBe(false);
  });

  it('reports the choice and starts from the remembered one for the project', async () => {
    const remembered = new Map<string, boolean>();
    const options = (project: string) => ({ collapsed: remembered.get(project), onCollapsed: (c: boolean) => remembered.set(project, c) });
    const row = await open(null, options('/one'));
    toggle(row).click();
    expect(remembered.get('/one')).toBe(true);

    document.body.textContent = '';
    hub?.dispose();
    const sameProject = await open(null, options('/one'));
    expect(body(sameProject).hidden).toBe(true);
    hub?.dispose();
    document.body.textContent = '';
    const otherProject = await open(null, options('/two'));
    expect(body(otherProject).hidden).toBe(false);
  });

  it('keeps the file view and the collapsed state together in the review pane', async () => {
    const files = [{ path: 'test/new-a.ts', kind: 'added' as const, mapped: false, reason: 'A.' }, { path: 'test/new-b.ts', kind: 'added' as const, mapped: false, reason: 'B.' }];
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onExplainCollapsed = vi.fn();
    mounted.push(
      mountLanternView(root, mapOf({ nodes: [node('src/svc.ts', 'service')], prs: [pr('24', { head: HEAD, files })] }), {
        pr: '24',
        explain: client(null),
        explainEnabled: true,
        explainCollapsed: false,
        onExplainCollapsed,
        readPrFile: async () => ({ ok: true, text: 'const a = 1;\n', truncated: false, binary: false, version: 'branch' }),
        readPrDiff: async () => ({ ok: true, diff: '@@ -1 +1 @@\n-a\n+b', truncated: false, binary: false }),
      }),
    );
    (root.querySelector('[data-pr-code="test/new-a.ts"]') as HTMLElement).click();
    await flush();
    toggle(root.querySelector('.lt-explain') as HTMLElement).click();
    expect(onExplainCollapsed).toHaveBeenCalledWith(true);
    (root.querySelector('[data-pr-code="test/new-b.ts"]') as HTMLElement).click();
    await flush();
    const next = root.querySelector('.lt-explain') as HTMLElement;
    expect(body(next).hidden).toBe(true);
    expect(root.querySelector('.lt-review-body')?.hasAttribute('hidden')).toBe(false);
  });
});

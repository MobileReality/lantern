// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/renderer/state', () => ({ activeProjectPath: () => '/proj' }));

const IDS = ['explain-modal', 'ex-proj', 'ex-title', 'ex-list', 'ex-doc', 'ex-code', 'ex-code-path', 'ex-code-body', 'ex-code-close', 'ex-max', 'ex-popout', 'ex-list-toggle', 'ex-close'];

const DOC = [
  '---',
  'title: T',
  'summary: S',
  '---',
  '',
  '## Background',
  '',
  '### Context',
  '',
  'Read [getUser](src/api/users.ts#getUser) first.',
].join('\n');

async function openWithDoc() {
  document.body.innerHTML = IDS.map((id) => `<div id="${id}" class="hidden"></div>`).join('');
  window.ccmws = { explainsList: vi.fn().mockResolvedValue([{ name: 'a.md', text: DOC, mtime: 1 }]) } as unknown as Window['ccmws'];
  vi.resetModules();
  const { openExplain } = await import('../src/renderer/features/explain');
  await openExplain();
  return document.getElementById('ex-doc')!;
}

describe('explainer links', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps a code reference clickable', async () => {
    const doc = await openWithDoc();
    const refs = doc.querySelectorAll('a.ex-ref');
    expect(refs).toHaveLength(1);
    expect(refs[0].getAttribute('href')).toBe('src/api/users.ts#getUser');
  });
});

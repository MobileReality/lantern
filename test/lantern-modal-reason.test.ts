// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { openCodeModal } from '../src/renderer/lib/codemodal';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';
import { openPrFile } from './helpers/pr-rows';

const REASON = 'Rejects a negative pid <b>before</b> it reaches kill()';
const PR = pr('24', {
  files: [
    { path: 'test/new-a.ts', kind: 'added', mapped: false, reason: REASON },
    { path: 'test/new-b.ts', kind: 'added', mapped: false },
  ],
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const mounted: ReturnType<typeof mountLanternView>[] = [];

function open() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, mapOf({ nodes: [node('src/svc.ts', 'service')], prs: [PR] }), {
    pr: '24',
    readPrFile: async () => ({ ok: true, text: 'const a = 1;\n', truncated: false, binary: false, version: 'branch' }),
    readPrDiff: async () => ({ ok: true, diff: '@@ -1 +1 @@\n-a\n+b', truncated: false, binary: false }),
  }));
  return root;
}

afterEach(() => {
  localStorage.clear();
  for (const view of mounted.splice(0)) view.dispose();
  document.body.textContent = '';
});

describe('reason at the top of the PR review pane', () => {
  for (const [name, mode, bodySel] of [['diff', 'diff', '.lt-code-body'], ['code', 'file', '.lt-code-body']] as const) {
    it(`${name} view shows the reason before the body, as text`, async () => {
      const root = open();
      openPrFile(root, 'test/new-a.ts', mode);
      await flush();
      const reason = root.querySelector('.lt-modal-reason') as HTMLElement;
      const body = root.querySelector(bodySel) as HTMLElement;
      expect(reason.textContent).toBe(`Reason${REASON}`);
      expect(reason.querySelector('b')).toBeNull();
      expect(reason.dataset.tip).toBe(REASON);
      expect(reason.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(reason.previousElementSibling?.classList.contains('lt-review-head')).toBe(true);
    });

    it(`${name} view shows nothing without a reason`, async () => {
      const root = open();
      openPrFile(root, 'test/new-b.ts', mode);
      await flush();
      expect(root.querySelector('.lt-review .lt-code-path')?.textContent).toContain('new-b.ts');
      expect(root.querySelector('.lt-modal-reason')).toBeNull();
    });
  }

  it('plain code modal is unchanged', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    openCodeModal(host, async () => ({ exists: true, text: 'x', truncated: 0 }), 'src/a.ts', '');
    await flush();
    expect(host.querySelector('.lt-modal-reason')).toBeNull();
    expect(host.querySelector('.modal-head')?.nextElementSibling?.classList.contains('lt-code-body')).toBe(true);
  });

  it('clicking the reason in the review pane expands it', async () => {
    const root = open();
    openPrFile(root, 'test/new-a.ts', 'diff');
    const reason = root.querySelector('.lt-modal-reason') as HTMLElement;
    reason.click();
    expect(reason.classList.contains('open')).toBe(true);
  });
});

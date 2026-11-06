// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node } from './helpers/lantern-map';

const DATA: LanternMap = mapOf({
  features: [
    { id: 'billing', description: 'Invoices and payments' },
    { id: 'auth', description: 'Sign-in' },
  ],
  platforms: [
    { id: 'web', kind: 'web', label: 'Dashboard site', count: 2 },
    { id: 'api', kind: 'backend', label: 'Readings API', count: 1 },
  ],
  nodes: [
    node('web/pay.ts', 'service', { platform: 'web', feature: 'billing', gotcha: 'Rounds half up', seeAlso: ['api/other.ts', 'web/gone.ts'], seeAlsoNote: 'Both format money' }),
    node('web/login.ts', 'service', { platform: 'web', feature: 'auth' }),
    node('api/other.ts', 'service', { platform: 'api' }),
  ],
  language: { primary: 'en', code: 'pl', available: ['en', 'pl'], fallbackCount: 2, fallbackKeys: ['web/pay.ts', 'web/pay.ts gotcha'] },
});

const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) view.dispose();
  document.body.replaceChildren();
});

function open(data = DATA, platform = '') {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, data, { platform }));
  const pay = [...root.querySelectorAll('.lt-pixi-node-access')].find((button) => button.getAttribute('aria-label') === 'web/pay.ts') as HTMLButtonElement;
  pay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return root;
}

describe('detail pane', () => {
  it('shows feature, platform, gotcha and see-also with its reason', () => {
    const root = open();
    const detail = root.querySelector('.lt-detail') as HTMLElement;
    expect(detail.querySelector('.feature')?.textContent).toBe('Feature: billing');
    expect(detail.querySelector('.feature')?.getAttribute('data-tip')).toBe('Invoices and payments');
    expect(detail.textContent).toContain('Platform: Dashboard site');
    expect(detail.querySelector('.gotcha')?.textContent).toContain('Rounds half up');
    expect([...detail.querySelectorAll('button[data-go]')].map((b) => b.getAttribute('data-go'))).toContain('api/other.ts');
    expect(detail.textContent).toContain('Both format money');
    expect(detail.textContent).toContain('gone.ts web/');
    expect(detail.querySelector('.detail-file-icon')?.getAttribute('src')).toContain('/assets/file-icons/typescript.svg');
    expect(detail.querySelector('button[data-go="api/other.ts"] .relation-file-icon')?.getAttribute('src')).toContain('/assets/file-icons/typescript.svg');
  });

  it('marks texts that fell back from another language', () => {
    const root = open();
    const fb = [...root.querySelectorAll('.lt-detail .fb')];
    expect(fb.map((e) => e.querySelector('sup')?.textContent)).toEqual(['en', 'en']);
    expect(fb[0].getAttribute('data-tip')).toContain('Not translated yet');
    expect(root.querySelector('.lt-detail .fb')?.textContent).toContain('web/pay.ts purpose');
  });

  it('marks nothing when every text is translated', () => {
    const root = open({ ...DATA, language: { ...DATA.language, fallbackCount: 0, fallbackKeys: [] } });
    expect(root.querySelector('.lt-detail .fb')).toBeNull();
  });

  it('following a see-also link into another platform switches the tab', () => {
    const root = open(DATA, 'web');
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('web');
    (root.querySelector('.lt-detail button[data-go="api/other.ts"]') as HTMLElement).click();
    expect(root.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('api');
    expect(root.querySelector('.lt-detail .path')?.textContent).toBe('other.ts api/');
  });

  it('omits the platform line when the map has no platform tabs', () => {
    const root = open({ ...DATA, platforms: [] });
    expect(root.querySelector('.lt-detail')?.textContent).not.toContain('Platform:');
  });
});

describe('feature filter', () => {
  it('lists feature chips with counts and narrows the graph', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, DATA));
    const chips = [...root.querySelectorAll('[data-feature]')].map((c) => `${c.getAttribute('data-feature')}:${c.querySelector('em')?.textContent}`);
    expect(chips).toEqual(['billing:1', 'auth:1', '-:1']);
    (root.querySelector('[data-feature="billing"]') as HTMLElement).click();
    expect(root.querySelectorAll('.lt-pixi-node-access')).toHaveLength(1);
    (root.querySelector('[data-clear="features"]') as HTMLElement).click();
    expect(root.querySelectorAll('.lt-pixi-node-access')).toHaveLength(3);
  });

  it('shows no feature block when the map has no features', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, { ...DATA, features: [] }));
    expect(root.querySelector('[data-feature]')).toBeNull();
  });

  it('only lists features present in the selected platform', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, DATA, { platform: 'api' }));
    expect([...root.querySelectorAll('[data-feature]')].map((c) => c.getAttribute('data-feature'))).toEqual(['-']);
  });
});

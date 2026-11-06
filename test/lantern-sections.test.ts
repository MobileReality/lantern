// @vitest-environment jsdom
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../src/main/lantern';
import type { RbacSection } from '../src/main/lantern';
import { mapOf } from './helpers/lantern-map';
import { NODES, RBAC, STATES, cite, mount, openSection, overlay, q } from './helpers/lantern-sections';

const PLATFORMS_FIXTURE = path.join(__dirname, 'fixtures', 'lantern-demo-platforms');

describe('section bar', () => {
  it('renders nothing when the map has no sections', () => {
    const root = mount(mapOf({ nodes: NODES }));
    expect(root.querySelector('.lt-secbar')).toBeNull();
    expect(overlay(root).hidden).toBe(true);
  });

  it('renders one button per section with its item count, under the platform tabs', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [RBAC, STATES] }));
    const buttons = [...root.querySelectorAll('.lt-sec')].map((b) => b.textContent);
    expect(buttons).toEqual(['RBAC 2', 'States 1']);
    expect(root.querySelector('.lt-tabs')?.nextElementSibling?.classList.contains('lt-secs')).toBe(true);
  });
});

describe('overlay', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    root = mount(mapOf({ nodes: NODES, sections: [RBAC, STATES] }));
  });

  it('opens over the graph, hides the left sidebar and inerts the graph', () => {
    expect(q(root, '.lt-side').hidden).toBe(false);
    openSection(root, 'rbac');
    expect(overlay(root).hidden).toBe(false);
    expect(q(root, '.lt-side').hidden).toBe(true);
    expect(q(root, '.lt-grid').classList.contains('sec-open')).toBe(true);
    expect(q(root, '.lt-main').hasAttribute('inert')).toBe(true);
    expect(q(root, '.lt-sec[data-section="rbac"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('closes with the close button, Esc and the same section button, and restores the sidebar', () => {
    const closers: Array<() => void> = [
      () => q(root, '.sx-close').click(),
      () => overlay(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      () => openSection(root, 'rbac'),
    ];
    for (const close of closers) {
      openSection(root, 'rbac');
      expect(q(root, '.lt-side').hidden).toBe(true);
      close();
      expect(overlay(root).hidden).toBe(true);
      expect(q(root, '.lt-side').hidden).toBe(false);
      expect(q(root, '.lt-main').hasAttribute('inert')).toBe(false);
    }
  });

  it('still closes on Esc after switching sections from the bar, because focus stays on the bar', () => {
    const press = () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    q(root, '.lt-sec[data-section="rbac"]').focus();
    openSection(root, 'rbac');
    q(root, '.lt-sec[data-section="states"]').focus();
    openSection(root, 'states');
    expect(document.activeElement?.getAttribute('data-section')).toBe('states');
    press();
    expect(overlay(root).hidden).toBe(true);
    expect(q(root, '.lt-side').hidden).toBe(false);
  });

  it('returns focus to the section button when the close button is used', () => {
    openSection(root, 'rbac');
    const close = q(root, '.sx-close');
    close.focus();
    close.click();
    expect(document.activeElement?.getAttribute('data-section')).toBe('rbac');
  });

  it('swaps content when another section is picked, without closing', () => {
    openSection(root, 'rbac');
    expect(overlay(root).textContent).toContain('Who can do what');
    openSection(root, 'states');
    expect(overlay(root).hidden).toBe(false);
    expect(q(root, '.lt-side').hidden).toBe(true);
    expect(overlay(root).querySelector('.sx-machine')).not.toBeNull();
    expect(overlay(root).querySelector('.sx-matrix')).toBeNull();
  });

  it('reports the open section so it can be remembered, and reopens it on mount', () => {
    const onSection = vi.fn();
    const first = mount(mapOf({ nodes: NODES, sections: [RBAC, STATES] }), { onSection });
    openSection(first, 'states');
    expect(onSection).toHaveBeenLastCalledWith('states');
    q(first, '.sx-close').click();
    expect(onSection).toHaveBeenLastCalledWith('');
    const again = mount(mapOf({ nodes: NODES, sections: [RBAC, STATES] }), { section: 'states' });
    expect(overlay(again).hidden).toBe(false);
    expect(q(again, '.lt-side').hidden).toBe(true);
    expect(q(again, '.lt-sec[aria-pressed="true"]').textContent).toContain('States');
  });
});

describe('renderers', () => {
  it('draws the rbac matrix with allow, conditional and missing cells, then sources and guards', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [RBAC] }));
    openSection(root, 'rbac');
    const o = overlay(root);
    expect(o.querySelector('.sx-intro')?.textContent).toBe('Roles come from the auth token.');
    const cells = [...o.querySelectorAll('.sx-matrix tbody td')];
    expect(cells.map((c) => c.querySelector('.sx-cell')?.className)).toEqual(['sx-cell allow', 'sx-cell cond']);
    expect(cells[1].textContent).toContain('only if');
    expect(cells[1].textContent).toContain('only their own orders');
    expect(cells[1].querySelector('.sx-cell')?.getAttribute('data-tip')).toBe('only their own orders');
    expect([...o.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Who may do what', 'How a role is decided', 'Where it is enforced']);
    expect(o.textContent).toContain('role claim in the JWT');
    expect(o.textContent).toContain('checks the owner');
  });

  it('marks a role without a cell for an area as not recorded', () => {
    const sparse: RbacSection = { ...RBAC, cells: [RBAC.cells[0]] };
    const root = mount(mapOf({ nodes: NODES, sections: [sparse] }));
    openSection(root, 'rbac');
    expect(overlay(root).querySelector('.sx-none')?.textContent).toBe('not recorded');
  });

  it('draws each state machine as a diagram with initial and final states and a trigger per transition', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [STATES] }));
    openSection(root, 'states');
    const o = overlay(root);
    expect(o.querySelector('.sx-head h2')?.textContent).toBe('States');
    expect(o.querySelectorAll('svg.sx-diagram .sx-st')).toHaveLength(3);
    expect(o.querySelectorAll('svg.sx-diagram .sx-st.initial')).toHaveLength(1);
    expect(o.querySelectorAll('svg.sx-diagram .sx-st.terminal')).toHaveLength(1);
    expect(o.querySelectorAll('svg.sx-diagram path.sx-arc[marker-end]').length).toBeGreaterThanOrEqual(3);
    const rows = [...o.querySelectorAll('.sx-table')[1].querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(1, 3).map((c) => c.textContent));
    expect(rows).toEqual([
      ['open → paid', 'customer pays'],
      ['paid → closed', 'shipment delivered'],
      ['paid → open', 'payment reversed'],
    ]);
  });

  it('draws entities with fields, declared and inferred badges, relations and owners (demo-platforms db)', async () => {
    const data = await load(PLATFORMS_FIXTURE);
    const root = mount(data);
    openSection(root, 'db');
    const o = overlay(root);
    expect(o.querySelector('.sx-head h2')?.textContent).toBe('Readings store');
    const card = q(o, '[data-entity-card="readings"]');
    expect(card.querySelector('.sx-note')?.textContent).toBe('one row per sample from a watch or phone');
    const fields = [...card.querySelectorAll('.sx-fields tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
    expect(fields).toEqual([
      ['userId', 'string', 'declared', 'partition key'],
      ['bpm', 'number', 'inferred', 'heart rate, absent for step-only samples'],
    ]);
    expect(card.querySelector('.sx-fields .sx-badge.inferred')).not.toBeNull();
    expect(card.textContent).toContain('Owned by');
    expect(card.querySelector('.sx-meta button[data-cite="api/src/repositories/readingRepository.ts"]')).not.toBeNull();
  });

  it('links relations to their target entity and lists an overview of all entities', () => {
    const db = {
      id: 'db',
      file: 'db.section',
      type: 'db' as const,
      platform: null,
      title: null,
      intro: null,
      entities: ['user', 'order'].map((id) => ({ id, kind: 'collection' as const, origin: 'inferred' as const, text: '', cites: [cite('src/order.ts')], owners: [], fields: [], relations: id === 'order' ? [{ field: 'userId', kind: 'ref' as const, target: 'user', text: 'buyer', cites: [cite('src/order.ts')] }] : [] })),
    };
    const root = mount(mapOf({ nodes: NODES, sections: [db] }));
    openSection(root, 'db');
    const o = overlay(root);
    expect([...o.querySelectorAll('.sx-overview tbody tr')].map((r) => r.querySelector('button')?.textContent)).toEqual(['user', 'order']);
    const go = q(o, '[data-entity-card="order"] .sx-rels button[data-entity="user"]');
    expect(go.textContent).toBe('user');
    expect(q(o, '[data-entity-card="user"] .sx-meta').textContent).toContain('order.userId');
    go.click();
    expect(overlay(root).hidden).toBe(false);
    expect(q(o, '[data-entity-card="user"]').classList.contains('flash')).toBe(true);
  });

  it('draws facts with notes and citations (demo-platforms facts)', async () => {
    const root = mount(await load(PLATFORMS_FIXTURE));
    openSection(root, 'facts');
    const o = overlay(root);
    expect(o.querySelector('.sx-head h2')?.textContent).toBe('Worth knowing');
    expect(o.querySelector('.sx-facts p')?.textContent).toContain('hands samples to the phone');
    expect([...o.querySelectorAll('.sx-facts .sx-cite')].map((c) => c.getAttribute('data-cite'))).toEqual(['watch/Sources/WatchApp.swift', 'mobile/src/sync/syncQueue.ts']);
  });

  it('marks text shown in the primary language for lack of a translation', () => {
    const language = { primary: 'en', code: 'pl', available: ['en', 'pl'], fallbackCount: 1, fallbackKeys: ['section rbac title'] };
    const root = mount(mapOf({ nodes: NODES, sections: [RBAC], language }));
    openSection(root, 'rbac');
    const fb = overlay(root).querySelector('.sx-head .fb');
    expect(fb?.textContent).toContain('Who can do what');
    expect(fb?.querySelector('sup')?.textContent).toBe('en');
  });
});

describe('escaping', () => {
  it('never turns markup in section data into elements', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const sec: RbacSection = { ...RBAC, title: evil, intro: evil, roles: [{ id: 'a"b', text: evil, cites: [cite(evil)] }], resources: [{ id: 'r', text: evil, cites: [] }], cells: [], sources: [], guards: [] };
    const root = mount(mapOf({ nodes: NODES, sections: [sec] }));
    openSection(root, 'rbac');
    expect(overlay(root).querySelector('img')).toBeNull();
    expect(overlay(root).textContent).toContain(evil);
  });
});

describe('citations', () => {
  it('closes the overlay and selects the cited file', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [RBAC] }));
    openSection(root, 'rbac');
    q(root, '.sx-matrix .sx-cite[data-cite="src/order.ts"]').click();
    expect(overlay(root).hidden).toBe(true);
    expect(q(root, '.lt-side').hidden).toBe(false);
    expect(q(root, '.lt-detail .path .file-label').getAttribute('data-tip')).toBe('src/order.ts');
  });

  it('renders an unmapped citation as plain text, not a link', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [RBAC] }));
    openSection(root, 'rbac');
    const gone = q(root, '.sx-cite.unmapped');
    expect(gone.tagName).toBe('SPAN');
    expect(gone.hasAttribute('data-cite')).toBe(false);
    expect(gone.getAttribute('data-tip')).toContain('not a mapped file');
  });

  it('shows a file that the current filters hide', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [RBAC] }));
    q(root, 'button[data-role="middleware"]').click();
    openSection(root, 'rbac');
    q(root, '.sx-matrix .sx-cite[data-cite="src/order.ts"]').click();
    expect(root.querySelectorAll('.lt-pixi-node-access')).toHaveLength(2);
    expect(q(root, '.lt-detail .path .file-label').getAttribute('data-tip')).toBe('src/order.ts');
  });
});

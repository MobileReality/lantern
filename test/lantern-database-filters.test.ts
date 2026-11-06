// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { DbEntity, DbSection, LanternMap } from '../src/main/lantern';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf } from './helpers/lantern-map';
import { NODES, cite, mount, openSection, overlay, q } from './helpers/lantern-sections';

const entity = (id: string, options: Partial<DbEntity> = {}): DbEntity => ({
  id,
  kind: 'table',
  origin: 'declared',
  text: `Stores ${id}`,
  cites: [cite('src/order.ts', id)],
  owners: [cite('src/auth.ts', `${id}Owner`)],
  fields: [{ name: `${id}Id`, type: 'string', origin: 'declared', text: `Identifier for ${id}`, cites: [cite('src/order.ts', `${id}Id`)] }],
  relations: [],
  ...options,
});

const ENTITIES: DbEntity[] = [
  entity('users', {
    fields: [
      { name: 'userId', type: 'uuid', origin: 'declared', text: 'Primary key', cites: [cite('src/auth.ts', 'userId')] },
      { name: 'emailAddress', type: 'string | null', origin: 'inferred', text: 'Login address', cites: [cite('src/auth.ts', 'email')] },
    ],
    relations: [{ field: 'tenantId', kind: 'fk', target: 'tenants', text: 'Owning workspace', cites: [cite('src/auth.ts')] }],
  }),
  entity('orders', { relations: [{ field: 'userId', kind: 'fk', target: 'users', text: 'Buyer', cites: [cite('src/order.ts')] }] }),
  entity('profiles', { kind: 'document', origin: 'inferred', relations: [{ field: 'user', kind: 'ref', target: 'users', text: 'Profile owner', cites: [cite('src/auth.ts')] }] }),
  entity('tenants'),
  entity('payments'),
  entity('shipments'),
  entity('products'),
  entity('inventory', { kind: 'view' }),
  entity('addresses', { kind: 'collection', origin: 'inferred' }),
  entity('audit-log', { kind: 'collection' }),
  entity('feature-flags', { kind: 'document', origin: 'inferred' }),
  entity('entity-with-an-extremely-long-name-that-must-wrap-without-expanding-the-panel', {
    kind: 'other',
    fields: [{ name: 'unbrokenFieldNameThatIsAlsoFarLongerThanAnyNormalSchemaIdentifier', type: 'Record<string, string> | null', origin: 'inferred', text: '', cites: [] }],
  }),
  entity('<img src=x onerror=alert(1)>', { fields: [{ name: '<script>bad()</script>', type: 'text', origin: 'declared', text: '', cites: [] }] }),
];

const section = (id = 'db', entities = ENTITIES): DbSection => ({ id, file: `${id}.section`, type: 'db', platform: null, title: 'Application data', intro: 'Tables, collections and documents.', entities });
const visibleCards = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-entity-card]')].filter((card) => !card.hidden);
const input = (root: ParentNode, name: string) => q(root as HTMLElement, `[data-db-filters] [name="${name}"]`) as HTMLInputElement;
const select = (root: ParentNode, name: string) => q(root as HTMLElement, `[data-db-filters] [name="${name}"]`) as HTMLSelectElement;
const setValue = (control: HTMLInputElement | HTMLSelectElement, value: string) => {
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
};

const DOMAINS = ['billing', 'catalog', 'shipping', 'support', 'identity', 'search'];
const bigSchema = (): DbEntity[] => {
  const all = DOMAINS.flatMap((domain) => Array.from({ length: 6 }, (_, index) => entity(`${domain}_${index}`, { kind: index % 2 ? 'collection' : 'table' })));
  const link = (id: string, field: string, target: string) => {
    const owner = all.find((item) => item.id === id);
    owner?.relations.push({ field, kind: 'ref', target, text: `${id} to ${target}`, cites: [] });
  };
  link('billing_0', 'invoiceOrder', 'billing_1');
  link('billing_1', 'customer', 'identity_0');
  link('catalog_0', 'seller', 'identity_0');
  link('shipping_0', 'order', 'billing_1');
  link('support_0', 'product', 'catalog_0');
  return all;
};

describe('database filters', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('narrows a 36 collection schema to the matches and keeps the relations between them', () => {
    const entities = bigSchema();
    expect(entities.length).toBeGreaterThan(30);
    const root = mount(mapOf({ nodes: NODES, sections: [section('db', entities)] }));
    openSection(root, 'db');
    const panel = overlay(root);
    expect(visibleCards(panel)).toHaveLength(entities.length);
    setValue(input(panel, 'query'), 'billing_');
    const shown = visibleCards(panel).map((card) => card.dataset.entityCard);
    expect(shown).toEqual(['billing_0', 'billing_1', 'billing_2', 'billing_3', 'billing_4', 'billing_5']);
    expect(q(panel, '[data-entity-card="billing_0"] .sx-rels').textContent).toContain('billing_1');
    expect(q(panel, '[data-db-result-count]').textContent).toBe('6 matching');
    expect([...panel.querySelectorAll<HTMLElement>('[data-overview-entity]')].filter((row) => !row.hidden)).toHaveLength(6);
  });

  it('pulls in direct neighbours of a narrowed set so their relations stay readable', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section('db', bigSchema())] }));
    openSection(root, 'db');
    const panel = overlay(root);
    setValue(input(panel, 'query'), 'billing_1');
    input(panel, 'related').click();
    expect(visibleCards(panel).map((card) => card.dataset.entityCard)).toEqual(['billing_0', 'billing_1', 'shipping_0', 'identity_0']);
    expect(q(panel, '[data-db-result-count]').textContent).toBe('1 matching · 3 related');
  });

  it('keeps the narrowed set when a relation target is outside it', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section('db', bigSchema())] }));
    openSection(root, 'db');
    const panel = overlay(root);
    setValue(input(panel, 'query'), 'billing_1');
    q(panel, '[data-entity-card="billing_1"] [data-entity="identity_0"]').click();
    expect(input(panel, 'query').value).toBe('billing_1');
    expect(input(panel, 'related').checked).toBe(true);
    expect(visibleCards(panel).map((card) => card.dataset.entityCard)).toContain('identity_0');
    expect(visibleCards(panel).length).toBeLessThan(10);
    expect(document.activeElement).toBe(q(panel, '[data-entity-card="identity_0"]'));
  });

  it('clears the search on Escape before closing the panel', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section('db', bigSchema())] }));
    openSection(root, 'db');
    const panel = overlay(root);
    const search = input(panel, 'query');
    setValue(search, 'billing_');
    search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(search.value).toBe('');
    expect(visibleCards(panel)).toHaveLength(36);
    expect(panel.hidden).toBe(false);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
  });

  it('combines field-name search, kind and origin filters across a realistic schema', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section()] }));
    openSection(root, 'db');
    const panel = overlay(root);
    setValue(input(panel, 'query'), 'emailaddress');
    expect(visibleCards(panel).map((card) => card.dataset.entityCard)).toEqual(['users']);
    expect(q(panel, '[data-db-result-count]').textContent).toBe('1 matching');

    setValue(input(panel, 'query'), 'id');
    setValue(select(panel, 'kind'), 'document');
    setValue(select(panel, 'origin'), 'inferred');
    expect(visibleCards(panel).map((card) => card.dataset.entityCard)).toEqual(['profiles', 'feature-flags']);
    expect([...panel.querySelectorAll<HTMLElement>('[data-overview-entity]')].filter((row) => !row.hidden)).toHaveLength(2);
  });

  it('adds direct incoming and outgoing neighbors and marks them separately', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section()] }));
    openSection(root, 'db');
    const panel = overlay(root);
    setValue(input(panel, 'query'), 'emailAddress');
    input(panel, 'related').click();
    expect(visibleCards(panel).map((card) => card.dataset.entityCard)).toEqual(['users', 'orders', 'profiles', 'tenants']);
    expect([...panel.querySelectorAll('.sx-entity.sx-related')].map((card) => (card as HTMLElement).dataset.entityCard)).toEqual(['orders', 'profiles', 'tenants']);
    expect(q(panel, '[data-db-result-count]').textContent).toBe('1 matching · 3 related');
  });

  it('reveals a relationship target that was excluded without dropping the search', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section()] }));
    openSection(root, 'db');
    const panel = overlay(root);
    setValue(input(panel, 'query'), 'orders');
    q(panel, '[data-entity-card="orders"] [data-entity="users"]').click();
    expect(input(panel, 'query').value).toBe('orders');
    expect(visibleCards(panel).map((card) => card.dataset.entityCard)).toEqual(['users', 'orders']);
    expect(document.activeElement).toBe(q(panel, '[data-entity-card="users"]'));
  });

  it('clears filters and focuses a relationship target beyond the direct neighbours', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section()] }));
    openSection(root, 'db');
    const panel = overlay(root);
    setValue(input(panel, 'query'), 'orders');
    input(panel, 'related').click();
    q(panel, '[data-entity-card="users"] [data-entity="tenants"]').click();
    const tenants = q(panel, '[data-entity-card="tenants"]');
    expect(input(panel, 'query').value).toBe('');
    expect(visibleCards(panel)).toHaveLength(ENTITIES.length);
    expect(document.activeElement).toBe(tenants);
    expect(tenants.classList.contains('flash')).toBe(true);
  });

  it('resets combined filters and explains an empty result', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section()] }));
    openSection(root, 'db');
    const panel = overlay(root);
    setValue(input(panel, 'query'), 'missing-entity');
    setValue(select(panel, 'kind'), 'view');
    expect(visibleCards(panel)).toHaveLength(0);
    expect(q(panel, '[data-db-empty]').hidden).toBe(false);
    q(panel, '.sx-db-clear').click();
    expect(input(panel, 'query').value).toBe('');
    expect(select(panel, 'kind').value).toBe('');
    expect(q(panel, '[data-db-empty]').hidden).toBe(true);
  });

  it('cancels implicit form submission without changing the active filter', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section()] }));
    openSection(root, 'db');
    const panel = overlay(root);
    setValue(input(panel, 'query'), 'orders');
    const form = q(panel, '[data-db-filters]');
    const submitted = form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(submitted).toBe(false);
    expect(input(panel, 'query').value).toBe('orders');
    expect(visibleCards(panel).map((card) => card.dataset.entityCard)).toEqual(['orders']);
  });

  it('keeps the active search, caret and result across a same-section data refresh', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const initial = mapOf({ nodes: NODES, sections: [section()] });
    const view = mountLanternView(root, initial);
    openSection(root, 'db');
    const search = input(overlay(root), 'query');
    setValue(search, 'users');
    search.focus();
    search.setSelectionRange(2, 2);
    const refreshed: LanternMap = { ...initial, sections: [section('db', [...ENTITIES, entity('user-sessions')])] };
    view.update(refreshed);
    const restored = input(overlay(root), 'query');
    expect(restored.value).toBe('users');
    expect(document.activeElement).toBe(restored);
    expect(restored.selectionStart).toBe(2);
    expect(visibleCards(overlay(root)).map((card) => card.dataset.entityCard)).toEqual(['users']);
  });

  it('drops a remembered kind when that kind disappears during refresh', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const initial = mapOf({ nodes: NODES, sections: [section()] });
    const view = mountLanternView(root, initial);
    openSection(root, 'db');
    setValue(select(overlay(root), 'kind'), 'document');
    expect(visibleCards(overlay(root))).toHaveLength(2);

    const onlyTables = ENTITIES.slice(0, 4).map((item) => ({ ...item, kind: 'table' as const }));
    const refreshed: LanternMap = { ...initial, sections: [section('db', onlyTables)] };
    view.update(refreshed);
    const normalized = select(overlay(root), 'kind');
    expect(normalized.value).toBe('');
    expect(normalized.selectedIndex).toBe(0);
    expect(normalized.selectedOptions[0]?.textContent).toBe('All kinds');
    expect(visibleCards(overlay(root))).toHaveLength(onlyTables.length);
    view.update(refreshed);
    const restored = select(overlay(root), 'kind');
    expect(restored.value).toBe('');
    expect(restored.selectedIndex).toBe(0);
    expect(restored.selectedOptions[0]?.textContent).toBe('All kinds');
    expect(visibleCards(overlay(root))).toHaveLength(onlyTables.length);
  });

  it('does not leak filters to another database section or a new controller', () => {
    const map = mapOf({ nodes: NODES, sections: [section('primary-db'), section('archive-db')] });
    const root = mount(map);
    openSection(root, 'primary-db');
    setValue(input(overlay(root), 'query'), 'orders');
    openSection(root, 'archive-db');
    expect(input(overlay(root), 'query').value).toBe('');
    openSection(root, 'primary-db');
    expect(input(overlay(root), 'query').value).toBe('orders');

    const fresh = mount(map);
    openSection(fresh, 'primary-db');
    expect(input(overlay(fresh), 'query').value).toBe('');
  });

  it('handles empty and hostile schemas without creating markup from data', () => {
    const root = mount(mapOf({ nodes: NODES, sections: [section('empty', []), section('hostile')] }));
    openSection(root, 'empty');
    expect(q(overlay(root), '[data-db-empty]').hidden).toBe(false);
    expect(q(overlay(root), '[data-db-result-count]').textContent).toBe('0 matching');
    openSection(root, 'hostile');
    expect(overlay(root).querySelector('img')).toBeNull();
    expect(overlay(root).querySelector('script')).toBeNull();
    setValue(input(overlay(root), 'query'), '<script>bad()');
    expect(visibleCards(overlay(root)).map((card) => card.dataset.entityCard)).toEqual(['<img src=x onerror=alert(1)>']);
  });
});

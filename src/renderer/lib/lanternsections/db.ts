import type { DbEntity, DbField, DbOrigin, DbRelation, DbSection } from '../../../main/lantern';
import { esc } from '../lanternctx';
import { citeHtml, citeLabel, citesHtml, isLinked, noteHtml } from './common';
import type { Renderer, SectionCtx } from './common';

const ORIGIN_HINT: Record<DbOrigin, string> = {
  declared: 'Read from DDL, a migration, an ORM entity or security rules',
  inferred: 'Read off repository code and types; nothing in the repo declares it',
};
const REL_WORD = { ref: 'reference', fk: 'foreign key', embed: 'embedded' };

function originBadge(origin: DbOrigin) {
  return `<span class="sx-badge ${esc(origin)}" data-tip="${esc(ORIGIN_HINT[origin])}">${esc(origin)}</span>`;
}

function jump(id: string, label = id) {
  return `<button class="sx-go" data-entity="${esc(id)}">${esc(label)}</button>`;
}

function overview(sec: DbSection) {
  if (sec.entities.length < 2) return '';
  const rows = sec.entities
    .map((e) => `<tr data-overview-entity="${esc(e.id)}"><td>${jump(e.id)}</td><td>${esc(e.kind)}</td><td>${originBadge(e.origin)}</td><td class="num">${e.fields.length}</td><td class="num">${e.relations.length}</td></tr>`)
    .join('');
  return `<h3>Overview</h3><div class="sx-table-wrap sx-db-overview"><table class="sx-table sx-overview"><thead><tr><th>Entity</th><th>Kind</th><th>Origin</th><th>Fields</th><th>Relations</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function fieldRow(ctx: SectionCtx, e: DbEntity, f: DbField) {
  const first = f.cites[0];
  const name = first && isLinked(ctx, first) ? `<button data-cite="${esc(first.path)}" data-tip="Select ${esc(citeLabel(first))} in the graph">${esc(f.name)}</button>` : `<span>${esc(f.name)}</span>`;
  const type = esc(f.type).split('|').join('|<wbr>');
  return `<tr><td>${name}</td><td class="sx-type">${type}</td><td>${originBadge(f.origin)}</td><td>${noteHtml(ctx, `field ${e.id} ${f.name}`, f.text)}</td></tr>`;
}

function relationRow(ctx: SectionCtx, e: DbEntity, r: DbRelation) {
  return `<li><span class="sx-id">${esc(r.field)}</span> → ${jump(r.target)} <span class="sx-badge">${esc(REL_WORD[r.kind])}</span> ${citesHtml(ctx, r.cites)}${noteHtml(ctx, `rel ${e.id} ${r.field} ${r.target}`, r.text)}</li>`;
}

function referencedBy(sec: DbSection, e: DbEntity) {
  const refs = sec.entities.flatMap((o) => o.relations.filter((r) => r.target === e.id).map((r) => jump(o.id, `${o.id}.${r.field}`)));
  return refs.length ? `<div class="sx-meta">Referenced by ${refs.join(', ')}</div>` : '';
}

function meta(ctx: SectionCtx, label: string, cites: DbEntity['cites']) {
  return cites.length ? `<div class="sx-meta">${label} ${cites.map((c) => citeHtml(ctx, c)).join('')}</div>` : '';
}

function card(ctx: SectionCtx, sec: DbSection, e: DbEntity) {
  const fields = e.fields.length ? `<table class="sx-fields"><tbody>${e.fields.map((f) => fieldRow(ctx, e, f)).join('')}</tbody></table>` : '';
  const rels = e.relations.length ? `<ul class="sx-rels">${e.relations.map((r) => relationRow(ctx, e, r)).join('')}</ul>` : '';
  const search = [e.id, ...e.fields.map((field) => field.name)].join('\n').toLocaleLowerCase();
  return (
    `<article class="sx-entity" data-entity-card="${esc(e.id)}" data-db-search="${esc(search)}" data-db-kind="${esc(e.kind)}" data-db-origin="${esc(e.origin)}"><header><span class="sx-id">${esc(e.id)}</span><span class="sx-badge">${esc(e.kind)}</span>${originBadge(e.origin)}</header>` +
    `${noteHtml(ctx, `entity ${e.id}`, e.text, 'p')}${fields}${rels}${referencedBy(sec, e)}${meta(ctx, 'Defined in', e.cites)}${meta(ctx, 'Owned by', e.owners)}</article>`
  );
}

function filterControls(sec: DbSection) {
  const kinds = [...new Set(sec.entities.map((entity) => entity.kind))].sort();
  return `<form class="sx-db-filters" data-db-filters>
    <label class="sx-db-search">Search entity or field<input type="search" name="query" autocomplete="off" placeholder="e.g. users or accountId"></label>
    <label>Kind<select name="kind"><option value="">All kinds</option>${kinds.map((kind) => `<option value="${esc(kind)}">${esc(kind)}</option>`).join('')}</select></label>
    <label>Origin<select name="origin"><option value="">All origins</option><option value="declared">declared</option><option value="inferred">inferred</option></select></label>
    <label class="sx-db-related"><input type="checkbox" name="related"> Include directly related</label>
    <button type="reset" class="sx-db-clear">Clear filters</button>
  </form>`;
}

interface DbFilterState {
  query: string;
  kind: string;
  origin: string;
  related: boolean;
}

const EMPTY_DB_FILTERS: DbFilterState = { query: '', kind: '', origin: '', related: false };

function readDbFilters(root: ParentNode): DbFilterState {
  const form = root.querySelector<HTMLFormElement>('[data-db-filters]');
  if (!form) return { ...EMPTY_DB_FILTERS };
  const values = new FormData(form);
  return {
    query: String(values.get('query') ?? ''),
    kind: String(values.get('kind') ?? ''),
    origin: String(values.get('origin') ?? ''),
    related: values.has('related'),
  };
}

function writeDbFilters(root: ParentNode, state: DbFilterState) {
  const form = root.querySelector<HTMLFormElement>('[data-db-filters]');
  if (!form) return;
  const query = form.elements.namedItem('query') as HTMLInputElement | null;
  const kind = form.elements.namedItem('kind') as HTMLSelectElement | null;
  const origin = form.elements.namedItem('origin') as HTMLSelectElement | null;
  const related = form.elements.namedItem('related') as HTMLInputElement | null;
  if (query) query.value = state.query;
  if (kind) {
    kind.value = state.kind;
    if (kind.selectedIndex === -1) kind.value = '';
  }
  if (origin) origin.value = state.origin;
  if (related) related.checked = state.related;
}

function applyDbFilters(root: ParentNode, state: DbFilterState) {
  const cards = [...root.querySelectorAll<HTMLElement>('[data-entity-card]')];
  const query = state.query.trim().toLocaleLowerCase();
  const matches = new Set(
    cards
      .filter((card) => (!query || (card.dataset.dbSearch ?? '').includes(query)) && (!state.kind || card.dataset.dbKind === state.kind) && (!state.origin || card.dataset.dbOrigin === state.origin))
      .map((card) => card.dataset.entityCard ?? ''),
  );
  const included = new Set(matches);
  if (state.related && matches.size) {
    for (const card of cards) {
      const id = card.dataset.entityCard ?? '';
      const targets = [...card.querySelectorAll<HTMLElement>('[data-entity]')].map((button) => button.dataset.entity ?? '');
      if (matches.has(id)) targets.forEach((target) => { included.add(target); });
      if (targets.some((target) => matches.has(target))) included.add(id);
    }
  }
  for (const card of cards) {
    const id = card.dataset.entityCard ?? '';
    card.hidden = !included.has(id);
    card.classList.toggle('sx-related', included.has(id) && !matches.has(id));
  }
  for (const row of root.querySelectorAll<HTMLElement>('[data-overview-entity]')) row.hidden = !included.has(row.dataset.overviewEntity ?? '');
  const count = root.querySelector<HTMLElement>('[data-db-result-count]');
  if (count) count.textContent = `${matches.size} matching${included.size > matches.size ? ` · ${included.size - matches.size} related` : ''}`;
  const empty = root.querySelector<HTMLElement>('[data-db-empty]');
  if (empty) empty.hidden = included.size > 0;
}

function clearDbFilters(root: ParentNode) {
  const state = { ...EMPTY_DB_FILTERS };
  writeDbFilters(root, state);
  applyDbFilters(root, state);
  return state;
}

const dbRenderer: Renderer<DbSection> = {
  label: 'Database',
  noun: 'entities',
  count: (sec) => sec.entities.length,
  body: (ctx, sec) => `<div class="sx-db">${filterControls(sec)}<div class="sx-db-summary"><span data-db-result-count aria-live="polite">${sec.entities.length} matching</span><span>Related entities are marked when included.</span></div>${overview(sec)}<div class="sx-db-empty" data-db-empty hidden><strong>No entities match these filters.</strong><span>Change or clear a filter to see the schema again.</span></div><div class="sx-entities">${sec.entities.map((e) => card(ctx, sec, e)).join('')}</div></div>`,
};

export { applyDbFilters, clearDbFilters, dbRenderer, readDbFilters, writeDbFilters };
export type { DbFilterState };

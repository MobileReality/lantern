import type { Arrow } from '../../main/lantern';
import { baseName } from './util';
import { ARROWS, KIND, KIND_TEXT, esc } from './lanternctx';
import { detailHtml } from './lanterndetail';
import { fileLabelHtml } from './file-label';
import { NO_FEATURE, activeGroups, isMissing, isWip } from './lanternlayout';
import type { SideContext } from './lanternctx';

function chip(attrs: string, style: string, pressed: boolean, label: string, count: number, cls = '') {
  return `<button class="chip ${cls}" ${style ? `style="${style}"` : ''} ${attrs} aria-pressed="${pressed}"><i></i>${label} <em>${count}</em></button>`;
}

function tally<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return m;
}

function featureBlock(ctx: SideContext) {
  const { data, filters, scope } = ctx;
  if (!data.features.length) return '';
  const counts = tally(scope.nodes, (n) => n.feature ?? NO_FEATURE);
  const listed = data.features.filter((f) => !filters.platform || counts.has(f.id));
  const chips = listed.map((f) => `<button class="chip" style="--c: var(--lt-ink-2)" data-feature="${esc(f.id)}" data-tip="${esc(f.description)}" aria-pressed="${filters.features.includes(f.id)}"><i></i>${esc(f.id)} <em>${counts.get(f.id) ?? 0}</em></button>`);
  const none = counts.get(NO_FEATURE);
  if (none) chips.push(`<button class="chip" style="--c: var(--lt-ink-3)" data-feature="${NO_FEATURE}" aria-pressed="${filters.features.includes(NO_FEATURE)}"><i></i>(no feature) <em>${none}</em></button>`);
  return `<h2>Feature <button data-clear="features">clear</button></h2><div class="chips">${chips.join('')}</div>`;
}

function roleBlock(ctx: SideContext) {
  const { filters, scope, profile } = ctx;
  const counts = tally(scope.nodes, (n) => n.role);
  const known = new Set(profile.layers.flatMap((l) => l.roles));
  const chips = profile.layers.flatMap((l) => l.roles.filter((r) => counts.has(r)).map((r) => chip(`data-role="${esc(r)}"`, `--c: var(--lt-l-${l.id})`, filters.roles.includes(r), esc(r), counts.get(r) ?? 0)));
  const unknown = [...counts.keys()].filter((r) => !known.has(r)).map((r) => chip(`data-role="${esc(r)}"`, '--c: var(--lt-l-support)', filters.roles.includes(r), esc(r), counts.get(r) ?? 0));
  return `<h2>Role <button data-clear="roles">clear</button></h2><div class="chips">${chips.join('')}${unknown.join('')}</div>`;
}

function dirBlock(ctx: SideContext) {
  const { filters, scope } = ctx;
  const counts = tally(scope.nodes, (n) => n.dir);
  const list = [...counts.keys()].sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a < b ? -1 : 1));
  const rows = list
    .map((d) => {
      const depth = d === '.' ? 0 : d.split('/').length - 1;
      const label = d === '.' ? '(project root)' : baseName(d);
      return `<button class="dir" data-dir="${esc(d)}" aria-pressed="${filters.dirs.includes(d)}" data-tip="${esc(d)}" style="padding-left:${6 + depth * 10}px"><span>${esc(label)}</span><em>${counts.get(d)}</em></button>`;
    })
    .join('');
  return `<h2>Directory <button data-clear="dirs">clear</button></h2><div class="dirs">${rows}</div>`;
}

function swatch(kind: string, start: boolean, end: boolean, uid: string) {
  const id = `lt-lg-head-${uid}-${kind}`;
  const ref = `url(#${id})`;
  const marker = `<defs><marker id="${id}" class="lt-head k-${kind}" viewBox="0 0 8 7" markerWidth="8" markerHeight="7" refX="8" refY="3.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,0 L8,3.5 L0,7 Z"/></marker></defs>`;
  const heads = `${start ? ` marker-start="${ref}"` : ''}${end ? ` marker-end="${ref}"` : ''}`;
  return `<div><svg class="kswatch" width="34" height="10">${marker}<path class="k-${kind}" d="M1,5 H33"${heads}/></svg>`;
}

function legendBlock(ctx: SideContext) {
  const boundary = ctx.filters.platform ? '<div><svg width="34" height="16"><rect x="1" y="2" width="32" height="12" rx="2" fill="none" stroke="var(--lt-ink-3)" stroke-dasharray="3 3"/></svg>other platform, click to open it</div>' : '';
  return (
    '<h2>How to read it</h2><div class="legend">' +
    swatch('send', false, true, ctx.uid) +
    'blue, solid: sends data into (&gt;)</div>' +
    swatch('take', true, false, ctx.uid) +
    'orange, dashed: takes data from (&lt;)</div>' +
    swatch('both', true, true, ctx.uid) +
    'pink, dash-dot: both ways (=)</div>' +
    swatch('ref', false, true, ctx.uid) +
    'lime, dotted: refers to (@), a skill file pointing at what it says to read or run</div>' +
    '<div>No lines are drawn until you pick a file. Click one and only its relations appear, coloured from that file&#39;s side, and everything else fades. Click it again, or empty space, to clear.</div>' +
    '<div>Lock (L): keep the picked file analysed. Click other files to read about them; nothing is redrawn. Esc stops inspecting, Unlock picks a new file.</div>' +
    '<div>Relation view: with a file picked, show only it and its relations. Files it takes data from sit on the left, files it sends into on the right, both-way partners above; for references, the files that refer to it sit on the left and the files it refers to on the right. Click a neighbour to centre on it, Esc to leave.</div>' +
    '<div><svg width="34" height="16"><rect x="1" y="2" width="32" height="12" rx="2" fill="none" stroke="var(--lt-glow)" stroke-width="1.6"/></svg>~ being changed, + being added (dashed), - being removed (struck through)</div>' +
    '<div><svg width="34" height="16"><rect x="1" y="2" width="32" height="12" rx="2" fill="none" stroke="var(--lt-ink-3)" stroke-width="1.6"/></svg>gone: file no longer exists (name struck through)</div>' +
    '<div><svg width="34" height="16"><rect x="1" y="2" width="32" height="12" rx="2" fill="none" stroke="var(--lt-ink-3)" stroke-dasharray="3 3"/></svg>outside system, not in the repo</div>' +
    `${boundary}</div>`
  );
}

function clearAllHtml(n: number) {
  if (!n) return '';
  return `<button class="clear-all" data-clear-all data-tip="Reset every filter and the search text">Clear all filters · ${n}</button>`;
}

function statsHtml(ctx: SideContext) {
  const { data, shown, scope } = ctx;
  const wipCount = scope.nodes.filter(isWip).length;
  return (
    `<div class="stats"><div><b>${shown.nodes}</b><span>of ${scope.nodes.length} files</span></div>` +
    `<div><b>${shown.edges}</b><span>of ${scope.relations.length} relations</span></div>` +
    `<div class="wip"><b>${wipCount}</b><span>in progress</span></div>` +
    `<div class="unm"><b>${data.unmappedCount}</b><span>unmapped</span></div></div>`
  );
}

function sideHtml(ctx: SideContext) {
  const { data, filters, showUnmapped, scope } = ctx;
  const kindCounts: Record<Arrow, number> = { '>': 0, '<': 0, '=': 0, '@': 0 };
  for (const r of scope.relations) kindCounts[r.arrow] += 1;
  const wipCount = scope.nodes.filter(isWip).length;
  const missingCount = scope.nodes.filter(isMissing).length;
  const unmappedCount = data.unmappedCount;
  const coverage = data.total ? `${data.total - unmappedCount} of ${data.total} source files mapped` : 'no source files found';
  const unmappedList = showUnmapped
    ? `<ul class="unmapped-list">${data.unmapped.map((p) => `<li data-tip="${esc(p)}">${fileLabelHtml(p)}</li>`).join('')}</ul>${unmappedCount > data.unmapped.length ? `<p class="none">and ${unmappedCount - data.unmapped.length} more</p>` : ''}`
    : '';
  const kindChips = ARROWS.map((k) => chip(`data-kind="${esc(k)}"`, '', filters.kinds.includes(k), KIND_TEXT[k], kindCounts[k], `k-${KIND[k]}`)).join('');

  return (
    `<div class="lt-brand"><h1 class="lt-proj" data-tip="${esc(data.project)}">${esc(data.project)}</h1><p class="sub">Architecture map, one node per source file</p></div>` +
    statsHtml(ctx) +
    `<div class="coverage">${esc(coverage)}</div>` +
    detailHtml(ctx) +
    `<input class="search" type="search" placeholder="Find a file or purpose" value="${esc(filters.q)}" aria-label="Find a file or purpose">` +
    clearAllHtml(activeGroups(filters, showUnmapped)) +
    `<h2>Relation <button data-clear="kinds">clear</button></h2><div class="chips">${kindChips}</div>` +
    roleBlock(ctx) +
    featureBlock(ctx) +
    `<h2>Progress</h2><div class="chips">${chip('data-wip="1"', '', filters.wip, 'only files in progress', wipCount, 'wip')}${chip('data-missing="1"', '', filters.missing, 'missing files', missingCount, 'gone')}${chip('data-unmapped="1"', '', showUnmapped, 'unmapped files', unmappedCount, 'unm')}</div>${unmappedList}` +
    dirBlock(ctx) +
    legendBlock(ctx)
  );
}

export { sideHtml, statsHtml, clearAllHtml };

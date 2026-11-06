import type { Arrow, LanternNode, LanternRelation } from '../../main/lantern';
import { platformLabel } from './lanternscope';
import { FLIP, GLYPH, KIND, codeButton, esc, textHtml } from './lanternctx';
import { isWip } from './lanternlayout';
import { lockBarHtml } from './lanternlock';
import type { SideContext } from './lanternctx';
import { fileLabelHtml } from './file-label';

function relationKey(r: LanternRelation) {
  const token = r.to ? `${r.to}${r.symbol ? `#${r.symbol}` : ''}` : `ext:${r.ext}`;
  return `${r.from} ${r.arrow} ${token}`;
}

function relLine(ctx: SideContext, rel: LanternRelation, glyph: string, target: string, mapped: boolean, kind: Arrow) {
  const t = mapped ? `<button data-go="${esc(target)}">${fileLabelHtml(target, 'relation-file-icon')}</button>` : `<span>${esc(target)}</span>`;
  const sym = rel.symbol ? `<span class="sym">#${esc(rel.symbol)}</span>` : '';
  const lab = rel.label ? `<span class="lab">${textHtml(ctx.data, relationKey(rel), rel.label)}</span>` : '';
  const code = mapped && ctx.canOpenCode ? codeButton(target, rel.symbol) : '';
  return `<li><span class="g k-${KIND[kind]}">${glyph}</span>${t}${sym}${code}${lab}</li>`;
}

function stateText(n: LanternNode) {
  const owner = n.owner ? ` by @${n.owner}` : '';
  if (n.marker === '~') return `Being changed${owner}`;
  if (n.marker === '+') return `Being added${owner}`;
  if (n.marker === '-') return `Being removed${owner}`;
  if (n.freshness === 'gone') return 'Gone — the file no longer exists';
  return 'At rest — mapped and confirmed';
}

function noteHtml(ctx: SideContext, n: LanternNode) {
  const { data, byPath } = ctx;
  let out = '';
  if (n.feature) {
    const desc = data.features.find((f) => f.id === n.feature)?.description ?? '';
    out += `<span class="feature" data-tip="${esc(desc)}">Feature: ${esc(n.feature)}</span>`;
  }
  if (n.platform && data.platforms.length >= 2) out += `<span class="feature plat">Platform: ${esc(platformLabel(data, n.platform) || n.platform)}</span>`;
  if (n.gotcha) out += `<div class="gotcha"><b>Gotcha</b>${textHtml(data, `${n.path} gotcha`, n.gotcha)}</div>`;
  if (n.seeAlso.length) {
    const rows = n.seeAlso.map((p) => (byPath.has(p) ? `<li><button data-go="${esc(p)}">${fileLabelHtml(p, 'relation-file-icon')}</button>${ctx.canOpenCode ? codeButton(p) : ''}</li>` : `<li>${fileLabelHtml(p)}</li>`));
    const reason = n.seeAlsoNote ? `<div class="none">${textHtml(data, `${n.path} see-also`, n.seeAlsoNote)}</div>` : '';
    out += `<h3>Easily confused with</h3><ul>${rows.join('')}</ul>${reason}`;
  }
  return out;
}

function relationBlockHtml(ctx: SideContext) {
  const { relationView, dense, canRelate } = ctx;
  if (!canRelate || (ctx.locked && ctx.inspected)) return '';
  const label = relationView ? 'Back to full graph' : 'Open relation view';
  const hint = dense
    ? `<div class="rv-hint" role="note"><span class="rv-hint-text"><b>Many relations in ${esc(dense.name)}</b> (${dense.count} files). The graph is hard to read at this size.</span><button class="rv-hint-go" data-relview>Open relation view</button><button class="rv-hint-x" data-rv-dismiss aria-label="Dismiss this hint" data-tip="Dismiss">×</button></div>`
    : '';
  return `<div class="rv-block"><button class="rv-open" data-relview aria-pressed="${relationView}">${label}</button>${hint}</div>`;
}

function detailHtml(ctx: SideContext) {
  const { data, byPath, incoming, profile } = ctx;
  const inspecting = ctx.locked && !!ctx.inspected;
  const shown = inspecting ? ctx.inspected : ctx.selected;
  const n = shown ? byPath.get(shown) : undefined;
  const bar = lockBarHtml(ctx);
  if (!n) return bar;
  const layer = profile.layerOf(n.role);
  const out = data.relations.filter((r) => r.from === n.path);
  const group = (title: string, arrow: Arrow, glyph: string) => {
    const rows = out.filter((r) => r.arrow === arrow).map((r) => relLine(ctx, r, glyph, r.to || `ext:${r.ext}`, !!(r.to && byPath.has(r.to)), arrow));
    return rows.length ? `<h3>${title}</h3><ul>${rows.join('')}</ul>` : '';
  };
  const incomingRows = (refs: boolean) => (incoming.get(n.path) ?? []).filter((r) => (r.arrow === '@') === refs).map((r) => relLine(ctx, r, GLYPH[r.arrow], r.from, true, FLIP[r.arrow]));
  const usedBy = incomingRows(false);
  const referredBy = incomingRows(true);
  let body =
    group('Sends data into', '>', GLYPH['>']) +
    group('Takes data from', '<', GLYPH['<']) +
    group('Both ways', '=', GLYPH['=']) +
    group('Refers to', '@', GLYPH['@']) +
    (usedBy.length ? `<h3>Used by</h3><ul>${usedBy.join('')}</ul>` : '') +
    (referredBy.length ? `<h3>Referred to by</h3><ul>${referredBy.join('')}</ul>` : '');
  if (!body) body = '<p class="none">No relations recorded for this file.</p>';
  const flag = (isWip(n) ? ' wip' : n.freshness === 'gone' ? ' gone' : '') + (inspecting ? ' insp' : '');
  const keepsSelection = ctx.locked && !inspecting;
  return (
    bar +
    `<section class="lt-detail${flag}" style="--c: var(--lt-l-${layer.id})">` +
    (keepsSelection ? '' : `<button class="close" data-go="" aria-label="${inspecting ? 'Stop inspecting' : 'Close details'}">×</button>`) +
    `<div class="path">${fileLabelHtml(n.path, 'detail-file-icon')}${ctx.canOpenCode && n.freshness !== 'gone' ? codeButton(n.path, '', 'Open this file') : ''}</div>` +
    `<span class="role">${esc(n.role)} · ${esc(layer.name)}</span>` +
    `<span class="state">${esc(stateText(n))}</span>` +
    relationBlockHtml(ctx) +
    `<p>${textHtml(data, n.path, n.purpose)}</p>${noteHtml(ctx, n)}` +
    `<div class="hash">hash ${esc(n.hash)}</div>${body}</section>`
  );
}

export { detailHtml, relationBlockHtml, relationKey };

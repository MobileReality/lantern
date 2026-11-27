import type { LanternNode, LanternPr, LanternPrFile, LanternPrFileKind } from '../../main/lantern';
import type { PrFileStats } from '../../main/lantern-prdiff';
import { providerOfRecordUrl } from '@shared/providers';
import { esc } from './lanternctx';
import { providerLogo } from './provider-logo';
import CHEVRON_ICON from '@renderer/assets/icons/chevron-down.svg';
import PEN_ICON from '@renderer/assets/icons/pen.svg';
import UNMAPPED_ICON from '@renderer/assets/icons/stat-unmapped.svg';
import { diffHtml, prInfoHtml, stateClass } from '@renderer/pr-info';
import { descriptionHostHtml } from './lanternprdescribe';
import { fileLabelHtml } from './file-label';
import type { PickedStep } from './lanternflow';
import { guideErrorOf, guideOf } from './lanternguide';

type PrMark = '+' | '~' | '-';
type FileMark = PrMark | 'related';

const MARK: Record<LanternPrFileKind, PrMark> = { added: '+', modified: '~', removed: '-' };
const GROUPS: { kind: LanternPrFileKind; title: string }[] = [
  { kind: 'added', title: 'Added' },
  { kind: 'modified', title: 'Modified' },
  { kind: 'removed', title: 'Removed' },
];

interface PrPanelContext {
  pr: LanternPr;
  byPath: Map<string, LanternNode>;
  selected: string | null;
  canOpenCode: boolean;
  canOpenDiff?: boolean;
  canOpenPrCode?: boolean;
  activeFilters: number;
  flowStep?: PickedStep | null;
  canGenerateReasons?: boolean;
  canMapMissing?: boolean;
  unmapped?: ReadonlySet<string>;
  reasonsBusy?: boolean;
  reasonsRunning?: boolean;
  canRefresh?: boolean;
  refreshBusy?: boolean;
  refreshNote?: string;
  stats?: PrFileStats;
  headOpen?: boolean;
}

function prMarks(pr: LanternPr, only?: ReadonlySet<string> | null) {
  return new Map(pr.files.filter((f) => !only || only.has(f.path)).map((f) => [f.path, MARK[f.kind]]));
}

function flowStepHtml(step: PickedStep | null | undefined) {
  if (!step) return '';
  const count = step.files.size;
  return `<div class="pr-flowmark" role="status"><span>Marking ${count} file${count === 1 ? '' : 's'} of the step <q>${esc(step.label)}</q></span><button data-flow-clear data-tip="Stop marking the files of this step">Clear</button></div>`;
}

function isHttpsUrl(url: string) {
  return /^https:\/\//i.test(url);
}

function reasonPill(f: LanternPrFile) {
  return f.reason ? '' : '<span class="pr-noreason" data-tip="The record gives no reason for this change">no reason</span>';
}

function reasonText(f: LanternPrFile) {
  return f.reason ? `<span class="pr-reason">${esc(f.reason)}</span>` : '';
}

function statHtml(ctx: PrPanelContext, path: string) {
  const stat = ctx.stats?.[path];
  if (!stat || (!stat.added && !stat.removed)) return '';
  return `<span class="pr-stat">${stat.added ? `<span class="df-stat-add">+${stat.added}</span>` : ''}${stat.removed ? `<span class="df-stat-del">\u2212${stat.removed}</span>` : ''}</span>`;
}

function newTag(f: LanternPrFile) {
  return f.kind === 'added' ? '<span class="pr-tag" data-tip="Its map record comes from the pull request branch">new</span>' : '';
}

function reviewSequence(pr: LanternPr): LanternPrFile[] {
  return pr.ordered ? pr.files : GROUPS.flatMap((g) => pr.files.filter((f) => f.kind === g.kind));
}

function fileRow(ctx: PrPanelContext, f: LanternPrFile) {
  const node = ctx.byPath.get(f.path);
  const live = !!node;
  const tag = !live ? '<span class="pr-tag">not in map</span>' : node.prNew ? newTag(f) : '';
  const cls = `pr-file${f.path === ctx.selected ? ' sel' : ''}${f.reason ? ' has-reason' : ''}${ctx.flowStep?.files.has(f.path) ? ' flow-hit' : ''}${live ? '' : ' off'}`;
  const inner = `<span class="pr-row-top">${fileLabelHtml(f.path)}${tag}${reasonPill(f)}${statHtml(ctx, f.path)}</span>${reasonText(f)}`;
  const tip = live ? f.path : `${f.path} (not in the map: opens the file without connections)`;
  const row = live || ctx.canOpenDiff || ctx.canOpenPrCode ? `<button class="pr-path" data-pr-go="${esc(f.path)}" data-tip="${esc(tip)}">${inner}</button>` : `<span class="pr-path">${inner}</span>`;
  return `<li class="${cls}" data-path="${esc(f.path)}">${row}</li>`;
}

function groupHtml(ctx: PrPanelContext, kind: LanternPrFileKind, title: string) {
  const files = ctx.pr.files.filter((f) => f.kind === kind);
  if (!files.length) return '';
  return `<h2 class="pr-${kind}"><span>${MARK[kind]} ${title}</span><em>${files.length}</em></h2><ul class="pr-files">${files.map((f) => fileRow(ctx, f)).join('')}</ul>`;
}

function orderedHtml(ctx: PrPanelContext) {
  const files = ctx.pr.files;
  return `<h2 class="pr-review"><span>Changed files</span><em>${files.length}</em></h2><ul class="pr-files pr-ordered">${files.map((f) => fileRow(ctx, f)).join('')}</ul>`;
}

function contextRow(icon: string, count: number, text: string, button: string) {
  return `<div class="pr-ctx-row"><span class="pr-ctx-icon">${icon}</span><span class="pr-ctx-text"><b>${count} file${count === 1 ? '' : 's'}</b> ${text}</span>${button}</div>`;
}

function contextHtml(ctx: PrPanelContext) {
  const files = ctx.pr.files;
  const missing = files.filter((f) => !f.reason).length;
  const unmapped = files.filter((f) => !ctx.byPath.has(f.path) && ctx.unmapped?.has(f.path)).length;
  const reasons =
    ctx.canGenerateReasons && (missing || ctx.reasonsRunning)
      ? contextRow(PEN_ICON, missing, 'without a reason', `<button class="lt-btn lt-primary" data-pr-reasons data-tip="Ask Claude for a one-sentence why per changed file, from the diff"${ctx.reasonsBusy ? ' disabled aria-busy="true"' : ''}>${ctx.reasonsRunning ? 'Writing reasons…' : 'Write reasons'}</button>`)
      : '';
  const map = ctx.canMapMissing && unmapped ? contextRow(UNMAPPED_ICON, unmapped, 'not in the map', `<button class="lt-btn pr-secondary" data-pr-map data-tip="Refresh the Lantern map with Claude so these files get their records and connections">Map ${unmapped} file${unmapped === 1 ? '' : 's'}</button>`) : '';
  if (!reasons && !map) return '';
  return `<h2 class="pr-context"><span>Context</span></h2><div class="pr-context-box pr-reasons-row" tabindex="-1">${reasons}${map}</div>`;
}

function mapPillHtml(ctx: PrPanelContext) {
  const missing = ctx.pr.files.filter((f) => !ctx.byPath.has(f.path) && ctx.unmapped?.has(f.path)).length;
  if (!ctx.canMapMissing || !missing) return '';
  return `<button class="pr-reasons" data-pr-map data-tip="Refresh the Lantern map with Claude so these files get their records and connections">Map ${missing} missing file${missing === 1 ? '' : 's'}</button>`;
}

function mapMissingHtml(ctx: PrPanelContext) {
  const pill = mapPillHtml(ctx);
  return pill ? `<div class="pr-meta pr-map-row">${pill}</div>` : '';
}

function openLinkHtml(pr: LanternPr) {
  const host = providerOfRecordUrl(pr.url);
  return isHttpsUrl(pr.url) ? `<a class="lt-btn lt-primary pr-open-link" href="${esc(pr.url)}" target="_blank" rel="noopener noreferrer">${host ? providerLogo(host).outerHTML : ''}View PR</a>` : '';
}

function actionsHtml(ctx: PrPanelContext, description: string) {
  const refresh = ctx.canRefresh ? `<button class="lt-btn pr-secondary pr-refresh" data-pr-refresh data-tip="Fetch from the remote and read this pull request again"${ctx.refreshBusy ? ' disabled aria-busy="true"' : ''}>${ctx.refreshBusy ? 'Refreshing…' : 'Refresh'}</button>` : '';
  const note = ctx.refreshNote ? `<span class="pr-reasons-note" role="status">${esc(ctx.refreshNote)}</span>` : '';
  if (!refresh && !description) return '';
  return `<div class="pr-actions pr-refresh-row" tabindex="-1"><span class="pr-desc-slot"></span><span class="pr-actions-gap"></span>${note}${refresh}</div>`;
}

function headOpenNow(ctx: PrPanelContext) {
  return ctx.headOpen ?? !guideOf(ctx.pr);
}

function headBarHtml(ctx: PrPanelContext, id: string, badge: string, link: string, open: boolean) {
  const label = open ? 'Hide the pull request overview' : 'Show the pull request overview';
  return (
    `<div class="pr-head-bar"><div class="pr-id">${id}${badge}</div><h1 class="pr-title" data-tip="${esc(ctx.pr.title)}">${esc(ctx.pr.title)}</h1>${link}` +
    `<button class="pr-head-toggle" data-pr-head-toggle aria-expanded="${open}" aria-controls="pr-head-more" aria-label="${label}" data-tip="${label}">${CHEVRON_ICON}</button></div>`
  );
}

function headMoreHtml(open: boolean, inner: string) {
  return `<div class="pr-head-more" id="pr-head-more"${open ? '' : ' hidden'}>${inner}</div>`;
}

function localHeaderHtml(ctx: PrPanelContext) {
  const pr = ctx.pr;
  const open = headOpenNow(ctx);
  const summary = pr.summary ? `<p class="pr-summary">${esc(pr.summary)}</p>` : '';
  const description = descriptionHostHtml(pr);
  const story = summary || description ? `<div class="pr-story">${summary}${description}</div>` : '';
  const bar = description ? '<div class="pr-actions" tabindex="-1"><span class="pr-desc-slot"></span></div>' : '';
  const more =
    `<div class="pr-head-top"><div class="pr-meta"><code>${esc(pr.branch)}</code> compared with where it left <code>${esc(pr.base)}</code></div>` +
    `<div class="pr-card-foot"><span>${diffHtml(pr)}</span></div></div>${story}${bar}`;
  return (
    `<div class="pr-head pr-local" data-open="${open}"><div class="pr-head-card">` +
    `${headBarHtml(ctx, '<span>local comparison</span>', '<span class="pr-badge pr-local">local</span>', '', open)}${headMoreHtml(open, more)}</div></div>${contextHtml(ctx)}`
  );
}

function headerHtml(ctx: PrPanelContext) {
  const pr = ctx.pr;
  if (pr.source === 'local') return localHeaderHtml(ctx);
  const open = headOpenNow(ctx);
  const summary = pr.summary ? `<p class="pr-summary">${esc(pr.summary)}</p>` : '';
  const description = descriptionHostHtml(pr);
  const story = summary || description ? `<div class="pr-story">${summary}${description}</div>` : '';
  const more =
    `<div class="pr-head-top"><div class="pr-meta"><code>${esc(pr.branch)}</code> → <code>${esc(pr.base)}</code></div>` +
    `${prInfoHtml(pr, Date.now())}${mapMissingHtml(ctx)}</div>${story}${actionsHtml(ctx, description)}`;
  return (
    `<div class="pr-head ${stateClass(pr)}" data-open="${open}"><div class="pr-head-card">` +
    `${headBarHtml(ctx, `<span>#${esc(pr.id)}</span>`, `<span class="pr-badge ${stateClass(pr)}" aria-label="Pull request state: ${pr.state}">${pr.state}</span>`, openLinkHtml(pr), open)}${headMoreHtml(open, more)}</div></div>`
  );
}

function guideErrorHtml(pr: LanternPr) {
  const error = guideErrorOf(pr);
  return error ? `<p class="pr-guide-error" role="note">${esc(error)}</p>` : '';
}

function prHeadHtml(ctx: PrPanelContext) {
  return `<button class="pr-back" data-pr-back>← Back to filters</button>${headerHtml(ctx)}${guideErrorHtml(ctx.pr)}${flowStepHtml(ctx.flowStep)}`;
}

function prPanelHtml(ctx: PrPanelContext) {
  const clear = ctx.activeFilters ? `<button class="clear-all" data-clear-all data-tip="Reset every filter and leave the pull request">Clear all filters · ${ctx.activeFilters}</button>` : '';
  return (
    prHeadHtml(ctx) +
    clear +
    (ctx.pr.ordered ? orderedHtml(ctx) : GROUPS.map((g) => groupHtml(ctx, g.kind, g.title)).join(''))
  );
}

export { fileRow, isHttpsUrl, prHeadHtml, prMarks, prPanelHtml, reviewSequence };
export type { FileMark, PrMark, PrPanelContext };

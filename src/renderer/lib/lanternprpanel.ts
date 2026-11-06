import type { LanternNode, LanternPr, LanternPrFile, LanternPrFileKind } from '../../main/lantern';
import { codeButton, esc } from './lanternctx';
import { fileCount, stateClass } from './lanternprs';
import { descriptionHostHtml } from './lanternprdescribe';
import { fileLabelHtml } from './file-label';
import type { PickedStep } from './lanternflow';

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
  reasonsNote?: string;
  canRefresh?: boolean;
  refreshBusy?: boolean;
  refreshNote?: string;
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

function diffButton(ctx: PrPanelContext, path: string) {
  if (!ctx.canOpenDiff) return '';
  return `<button class="diff-open" data-pr-diff="${esc(path)}" data-tip="Show diff" aria-label="Show diff of ${esc(path)}">diff</button>`;
}

function prCodeButton(ctx: PrPanelContext, f: LanternPrFile) {
  if (!ctx.canOpenPrCode) return '';
  const local = ctx.pr.source === 'local';
  const title = f.kind === 'removed' ? (local ? 'Open the version before this change' : `Open version before PR #${ctx.pr.id}`) : local ? 'Open the changed version' : `Open PR #${ctx.pr.id} branch version`;
  return `<button class="code-open" data-pr-code="${esc(f.path)}" data-tip="${esc(title)}" aria-label="${esc(`${title}: ${f.path}`)}">&lt;/&gt;</button>`;
}

function reasonPill(f: LanternPrFile) {
  return f.reason ? '' : '<span class="pr-noreason" data-tip="The record gives no reason for this change">no reason</span>';
}

function reasonText(f: LanternPrFile) {
  return f.reason ? `<div class="pr-reason">${esc(f.reason)}</div>` : '';
}

function newTag(f: LanternPrFile) {
  return f.kind === 'added' ? '<span class="pr-tag" data-tip="Its map record comes from the pull request branch">new</span>' : '';
}

const KIND_TITLE: Record<LanternPrFileKind, string> = { added: 'Added', modified: 'Modified', removed: 'Removed' };

function reviewSequence(pr: LanternPr): LanternPrFile[] {
  return pr.ordered ? pr.files : GROUPS.flatMap((g) => pr.files.filter((f) => f.kind === g.kind));
}

function stepHtml(f: LanternPrFile, step: number, total: number) {
  return `<span class="pr-num" data-tip="Review step ${step} of ${total}">${step}</span><span class="pr-kind pr-kind-${f.kind}" data-tip="${KIND_TITLE[f.kind]}">${MARK[f.kind]}</span>`;
}

function fileRow(ctx: PrPanelContext, f: LanternPrFile, step = 0) {
  const lead = step ? stepHtml(f, step, ctx.pr.files.length) : '';
  const node = ctx.byPath.get(f.path);
  const fromBranch = !!node?.prNew;
  const live = !!node;
  const cls = `pr-file${f.path === ctx.selected ? ' sel' : ''}${f.reason ? ' has-reason' : ''}${ctx.flowStep?.files.has(f.path) ? ' flow-hit' : ''}`;
  if (!live) {
    const name = ctx.canOpenDiff || ctx.canOpenPrCode ? `<button class="pr-path" data-pr-go="${esc(f.path)}" data-tip="${esc(`${f.path} (not in the map: opens the file without connections)`)}">${fileLabelHtml(f.path)}</button>` : `<span class="pr-path">${fileLabelHtml(f.path)}</span>`;
    return `<li class="${cls} off" data-tip="${esc(f.path)}">${lead}${name}<span class="pr-tag">not in map</span>${reasonPill(f)}${prCodeButton(ctx, f)}${diffButton(ctx, f.path)}${reasonText(f)}</li>`;
  }
  const code = fromBranch ? prCodeButton(ctx, f) : ctx.canOpenCode ? codeButton(f.path) : '';
  const tag = fromBranch ? newTag(f) : '';
  return `<li class="${cls}">${lead}<button class="pr-path" data-pr-go="${esc(f.path)}" data-tip="${esc(f.path)}">${fileLabelHtml(f.path)}</button>${tag}${reasonPill(f)}${code}${diffButton(ctx, f.path)}${reasonText(f)}</li>`;
}

function groupHtml(ctx: PrPanelContext, kind: LanternPrFileKind, title: string) {
  const files = ctx.pr.files.filter((f) => f.kind === kind);
  if (!files.length) return '';
  return `<h2 class="pr-${kind}"><span>${MARK[kind]} ${title}</span><em>${files.length}</em></h2><ul class="pr-files">${files.map((f) => fileRow(ctx, f)).join('')}</ul>`;
}

function orderedHtml(ctx: PrPanelContext) {
  const files = ctx.pr.files;
  return `<h2 class="pr-review"><span>Review order</span><em>${files.length}</em></h2><ul class="pr-files pr-ordered">${files.map((f, i) => fileRow(ctx, f, i + 1)).join('')}</ul>`;
}

function reasonsHtml(ctx: PrPanelContext) {
  const files = ctx.pr.files;
  if (!ctx.canGenerateReasons || !files.length) return '';
  const missing = files.filter((f) => !f.reason).length;
  const note = ctx.reasonsNote ? `<span class="pr-reasons-note" role="status">${esc(ctx.reasonsNote)}</span>` : '';
  if (!missing && !ctx.reasonsRunning) return `<div class="pr-meta pr-reasons-row" tabindex="-1"><span>Reasons written by Claude from the diff</span>${note}</div>`;
  const label = ctx.reasonsRunning ? 'Writing reasons…' : `Write reasons for ${missing} file${missing === 1 ? '' : 's'}`;
  return `<div class="pr-meta pr-reasons-row" tabindex="-1"><button class="pr-reasons" data-pr-reasons data-tip="Ask Claude for a one-sentence why per changed file, from the diff"${ctx.reasonsBusy ? ' disabled aria-busy="true"' : ''}>${label}</button>${note}</div>`;
}

function mapMissingHtml(ctx: PrPanelContext) {
  const missing = ctx.pr.files.filter((f) => !ctx.byPath.has(f.path) && ctx.unmapped?.has(f.path)).length;
  if (!ctx.canMapMissing || !missing) return '';
  return `<div class="pr-meta pr-reasons-row"><button class="pr-reasons" data-pr-map data-tip="Refresh the Lantern map with Claude so these files get their records and connections">Map ${missing} missing file${missing === 1 ? '' : 's'}</button></div>`;
}

function refreshHtml(ctx: PrPanelContext) {
  if (!ctx.canRefresh) return '';
  const note = ctx.refreshNote ? `<span class="pr-reasons-note" role="status">${esc(ctx.refreshNote)}</span>` : '';
  return `<div class="pr-meta pr-reasons-row pr-refresh-row" tabindex="-1"><button class="pr-reasons" data-pr-refresh data-tip="Fetch from the remote and read this pull request again"${ctx.refreshBusy ? ' disabled aria-busy="true"' : ''}>${ctx.refreshBusy ? 'Refreshing…' : 'Refresh'}</button>${note}</div>`;
}

function localHeaderHtml(ctx: PrPanelContext) {
  const pr = ctx.pr;
  const meta = `<div class="pr-meta"><code>${esc(pr.branch)}</code> compared with where it left <code>${esc(pr.base)}</code></div>`;
  const summary = pr.summary ? `<p class="pr-summary">${esc(pr.summary)}</p>` : '';
  return `<div class="pr-head pr-local"><div class="pr-id"><span class="pr-badge pr-local">local</span></div><h1 class="pr-title">${esc(pr.title)}</h1>${meta}<div class="pr-meta">${fileCount(pr)}</div>${summary}${descriptionHostHtml(pr)}${mapMissingHtml(ctx)}${reasonsHtml(ctx)}</div>`;
}

function headerHtml(ctx: PrPanelContext) {
  const pr = ctx.pr;
  if (pr.source === 'local') return localHeaderHtml(ctx);
  const link = isHttpsUrl(pr.url) ? `<a class="pr-open-link" href="${esc(pr.url)}" target="_blank" rel="noopener noreferrer">Open PR</a>` : '';
  const summary = pr.summary ? `<p class="pr-summary">${esc(pr.summary)}</p>` : '';
  return (
    `<div class="pr-head ${stateClass(pr)}"><div class="pr-id"><span>#${esc(pr.id)}</span><span class="pr-badge ${stateClass(pr)}" aria-label="Pull request state: ${pr.state}">${pr.state}</span></div>` +
    `<h1 class="pr-title">${esc(pr.title)}</h1>` +
    `<div class="pr-meta"><code>${esc(pr.branch)}</code> → <code>${esc(pr.base)}</code></div>` +
    `<div class="pr-meta">Opened ${esc(pr.opened)} · ${fileCount(pr)}</div>${summary}${descriptionHostHtml(pr)}${link}${mapMissingHtml(ctx)}${refreshHtml(ctx)}</div>`
  );
}

function prPanelHtml(ctx: PrPanelContext) {
  const clear = ctx.activeFilters ? `<button class="clear-all" data-clear-all data-tip="Reset every filter and leave the pull request">Clear all filters · ${ctx.activeFilters}</button>` : '';
  return (
    '<button class="pr-back" data-pr-back>← Back to filters</button>' +
    headerHtml(ctx) +
    flowStepHtml(ctx.flowStep) +
    clear +
    (ctx.pr.ordered ? orderedHtml(ctx) : GROUPS.map((g) => groupHtml(ctx, g.kind, g.title)).join(''))
  );
}

export { fileRow, isHttpsUrl, prMarks, prPanelHtml, reviewSequence };
export type { FileMark, PrMark, PrPanelContext };

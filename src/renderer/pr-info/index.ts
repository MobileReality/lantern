import type { LanternPr, LanternPrPerson, LanternPrReviewer } from '@main/lantern';
import { esc } from '@renderer/lib/lanternctx';
import { exactTime, plural, timeAgo } from '@renderer/lib/util';

const SEP = ' <span class="pr-sep" aria-hidden="true">∙</span> ';

function initials(name: string) {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words[words.length - 1][0] ?? '') : '')).toUpperCase() || '?';
}

function avatarHtml(person: LanternPrPerson | undefined, size: 'sm' | 'md' = 'md') {
  if (!person) return '';
  const cls = `pr-avatar pr-avatar-${size}`;
  if (person.avatar?.startsWith('data:image/')) return `<img class="${cls}" src="${esc(person.avatar)}" alt="">`;
  return `<span class="${cls} pr-avatar-initials" aria-hidden="true">${esc(initials(person.name))}</span>`;
}

function timeHtml(stamp: string, now: number, focusable: boolean) {
  return `<time datetime="${esc(stamp)}" data-tip="${esc(exactTime(stamp))}"${focusable ? ' tabindex="0"' : ''}>${esc(timeAgo(stamp, now))}</time>`;
}

function stateClass(pr: LanternPr) {
  return pr.state === 'declined' ? 'pr-declined-state' : `pr-${pr.state}`;
}

function stateLabel(pr: LanternPr) {
  return pr.info?.draft && pr.state === 'open' ? 'draft' : pr.state;
}

function diffHtml(pr: LanternPr) {
  const kinds = (['added', 'modified', 'removed'] as const).map((k) => [k, pr.files.filter((f) => f.kind === k).length] as const).filter(([, n]) => n);
  return [esc(plural(pr.files.length, 'file')), ...kinds.map(([k, n]) => `<span class="pr-n-${k}">${n} ${k}</span>`)].join(SEP);
}

function bylineHtml(pr: LanternPr, now: number, inSidebar: boolean) {
  const author = pr.info?.author;
  const merged = pr.state === 'merged' && pr.mergedAt;
  const when = merged ? `merged ${timeHtml(pr.mergedAt as string, now, inSidebar)}` : `opened ${timeHtml(pr.info?.created ?? pr.opened, now, inSidebar)}`;
  if (!author) return `<div class="pr-card-by">${when.charAt(0).toUpperCase()}${when.slice(1)}</div>`;
  return `<div class="pr-card-by">${avatarHtml(author, 'sm')}<span><span class="pr-card-who">${esc(author.name)}</span>${SEP}${when}</span></div>`;
}

function footHtml(pr: LanternPr) {
  return `<div class="pr-card-foot"><span>${diffHtml(pr)}</span>${reviewHtml(pr.info?.reviewers)}</div>`;
}

function reviewHtml(reviewers: LanternPrReviewer[] | undefined) {
  if (!reviewers?.length) return '';
  const changes = reviewers.filter((r) => r.changes).length;
  if (changes) return `<span class="pr-card-review pr-rv-changes">${esc(`${changes} requested changes`)}</span>`;
  const approved = reviewers.filter((r) => r.approved).length;
  return `<span class="pr-card-review${approved ? ' pr-rv-approved' : ''}">${approved} of ${reviewers.length} approved</span>`;
}

function prCard(pr: LanternPr, now: number): HTMLElement {
  const card = document.createElement('div');
  card.className = `pr-card ${stateClass(pr)}`;
  card.innerHTML =
    `<div class="pr-card-head"><span class="pr-card-id">#${esc(pr.id)}</span><span class="pr-badge ${stateClass(pr)}">${esc(stateLabel(pr))}</span></div>` +
    `<div class="pr-card-title">${esc(pr.title)}</div>` +
    `<div class="pr-card-branches"><code>${esc(pr.branch)}</code> → <code>${esc(pr.hostBase ?? pr.base)}</code></div>` +
    bylineHtml(pr, now, false) +
    footHtml(pr);
  return card;
}

function localFootHtml(pr: LanternPr) {
  const reasons = pr.files.filter((f) => f.reason).length;
  const reasonsHtml = reasons ? `<span class="pr-card-review">${esc(`${reasons} of ${pr.files.length} with reasons`)}</span>` : '';
  return `<div class="pr-card-foot"><span>${diffHtml(pr)}</span>${reasonsHtml}</div>`;
}

function localCard(pr: LanternPr): HTMLElement {
  const card = document.createElement('div');
  card.className = 'pr-card pr-local';
  card.innerHTML =
    `<div class="pr-card-head"><span class="pr-card-id">local comparison</span><span class="pr-badge pr-local">local</span></div>` +
    `<div class="pr-card-title">${esc(pr.title)}</div>` +
    `<div class="pr-card-branches"><code>${esc(pr.branch)}</code> compared with where it left <code>${esc(pr.base)}</code></div>` +
    localFootHtml(pr);
  return card;
}

function prInfoHtml(pr: LanternPr, now: number) {
  return bylineHtml(pr, now, true) + footHtml(pr);
}

export { diffHtml, initials, localCard, prCard, prInfoHtml, stateClass };

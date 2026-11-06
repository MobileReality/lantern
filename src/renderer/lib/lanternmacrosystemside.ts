import { esc } from './lanternctx';
import { FOUNDATION_HEADING, plural } from './lanternmacro';
import type { SystemArea, SystemEntry, SystemUses } from './lanternmacrosystems';

const SYSTEM_NOTE = 'An outside system. It is not part of this repo.';
const PR_SYSTEM_NOTE = 'A file this pull request changes talks to it.';

function relations(count: number) {
  return `<em>${plural(count, 'relation')}</em>`;
}

function featureRow(area: SystemArea, feature: SystemArea['features'][number]) {
  return `<li><button data-macro-feature="${esc(feature.id)}" data-tip="Select ${esc(feature.name)} in ${esc(area.name)}">${esc(feature.name)}</button> ${relations(feature.count)}</li>`;
}

function areaBlock(area: SystemArea) {
  const head = `<h3 class="lt-sys-area"><button data-macro-area="${esc(area.key)}" data-tip="Select ${esc(area.name)}">${esc(area.name)}</button> ${relations(area.count)}</h3>`;
  return `${head}<ul class="lt-sys-uses">${area.features.map((feature) => featureRow(area, feature)).join('')}</ul>`;
}

function entryRow(entry: SystemEntry) {
  return `<li><button data-macro-go="${esc(entry.key)}" data-tip="Select ${esc(entry.name)}">${esc(entry.name)}</button> ${relations(entry.count)}</li>`;
}

function foundationBlock(entries: readonly SystemEntry[]) {
  if (!entries.length) return '';
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return `<h3 class="lt-sys-area">${FOUNDATION_HEADING} ${relations(total)}</h3><ul class="lt-sys-uses">${entries.map(entryRow).join('')}</ul>`;
}

function systemUsesHtml(uses: SystemUses, touchedByPr: boolean) {
  const touched = touchedByPr ? `<p class="lt-sentence">${PR_SYSTEM_NOTE}</p>` : '';
  const body = uses.areas.map(areaBlock).join('') + foundationBlock(uses.foundation);
  return (
    '<section class="lt-detail" style="--c: var(--lt-l-system)"><button class="close" data-macro-go="" aria-label="Close details">×</button>' +
    `<div class="path"><span>${esc(uses.name)}</span></div>` +
    `<span class="role">outside system · ${plural(uses.total, 'relation')}</span>` +
    `<p class="lt-purpose">${SYSTEM_NOTE}</p>` +
    touched +
    `<h2 class="lt-sys-heading">Used by</h2>${body || '<p class="none">No block of this repo talks to it.</p>'}` +
    '</section>'
  );
}

export { PR_SYSTEM_NOTE, SYSTEM_NOTE, systemUsesHtml };

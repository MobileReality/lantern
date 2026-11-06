import type { LanternNode, LanternPr, LanternRelation } from '@main/lantern';
import { VIEW, say } from '@shared/lantern-plan-messages';
import { planFilePaths } from './lanternplanfocus';
import type { PlanFocus } from './lanternplanfocus';

const PRONLY_ICON = '<svg class="pronly-ico" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1,1.5 H11 L7.1,6.3 V10.5 L4.9,9.4 V6.3 Z" fill="currentColor"/></svg>';

const PRONLY_OFF_TITLE = 'Hide every file that is not part of this pull request';
const PRONLY_ON_TITLE = 'Bring the whole graph back';

function prOnlySet(pr: LanternPr, byPath: ReadonlyMap<string, LanternNode>): ReadonlySet<string> {
  return new Set(pr.files.map((f) => f.path).filter((p) => byPath.has(p)));
}

function planOnlySet(focus: PlanFocus, byPath: ReadonlyMap<string, LanternNode>): ReadonlySet<string> {
  return new Set([...planFilePaths(focus)].filter((p) => byPath.has(p)));
}

function planOnlyLabel(on: boolean, shown: number) {
  return on ? say(VIEW.PLANONLY_ON_LABEL, { count: shown }) : say(VIEW.PLANONLY_OFF_LABEL);
}

function planOnlyTitle(on: boolean) {
  return say(on ? VIEW.PLANONLY_ON_TITLE : VIEW.PLANONLY_OFF_TITLE);
}

function planHiddenNote(count: number) {
  return count ? say(count === 1 ? VIEW.PLANONLY_HIDDEN_ONE : VIEW.PLANONLY_HIDDEN_MANY, { count }) : '';
}

function prOnlyLabel(on: boolean, shown: number) {
  return on ? `Showing only PR files · ${shown}` : 'Show only PR files';
}

function hiddenNeighbours(relations: readonly LanternRelation[], byPath: ReadonlyMap<string, LanternNode>, only: ReadonlySet<string>, path: string) {
  const hidden = new Set<string>();
  for (const r of relations) {
    const other = r.from === path ? r.to : r.to === path ? r.from : null;
    if (other && other !== path && byPath.has(other) && !only.has(other)) hidden.add(other);
  }
  return hidden.size;
}

function hiddenNote(count: number) {
  return count ? `${count} related ${count === 1 ? 'file' : 'files'} hidden by the PR filter` : '';
}

export { PRONLY_ICON, PRONLY_OFF_TITLE, PRONLY_ON_TITLE, hiddenNeighbours, hiddenNote, planHiddenNote, planOnlyLabel, planOnlySet, planOnlyTitle, prOnlyLabel, prOnlySet };

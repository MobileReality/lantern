import type { ExtensionScope, ExtensionSlot } from '@shared/extension-slots';
import { msg } from '@shared/lang/messages';
import { el } from '../lib/util';
import type { AttachedRow, CandidateRow } from './skills-state';
import { otherScope } from './skills-state';

export const scopeLabel = (scope: ExtensionScope) => msg(`skillsExtras.scope.${scope}`);

export const slotLabel = (slot: ExtensionSlot) => msg(`skillsExtras.slot.${slot}`);

const FOCUS_KEY = 'fk';

export const focusKey = (zone: string, name: string) => `${zone}:${name}`;

export function withFocusKey<T extends HTMLElement>(node: T, zone: string, name: string): T {
  node.dataset[FOCUS_KEY] = focusKey(zone, name);
  return node;
}

export function scopeBadge(name: string, scope: ExtensionScope, onMove: (() => void) | null) {
  const label = scopeLabel(scope);
  if (!onMove) return el('span', `sk-scope sk-scope-${scope}`, label);
  const badge = el('button', `sk-scope sk-scope-${scope}`, label);
  badge.type = 'button';
  badge.tabIndex = -1;
  badge.dataset.scope = scope;
  badge.dataset.tip = msg(`skillsExtras.scope.${scope}Tip`);
  badge.setAttribute('aria-label', msg('skillsExtras.scope.moveLabel', { name, scope: label, other: scopeLabel(otherScope(scope)) }));
  badge.addEventListener('click', onMove);
  return badge;
}

interface AttachedHandlers {
  slot: ExtensionSlot;
  scoped: boolean;
  onMove: () => void;
  onDetach: () => void;
  onLink: (() => void) | null;
}

export function attachedItem(row: AttachedRow, { slot, scoped, onMove, onDetach, onLink }: AttachedHandlers) {
  const item = el('div', `sk-arow${row.missing ? ' missing' : ''}`);
  item.setAttribute('role', 'listitem');
  item.setAttribute('aria-keyshortcuts', 'Delete Backspace');
  item.tabIndex = -1;
  item.dataset.extra = row.name;
  item.dataset.attachedScope = row.scope;
  withFocusKey(item, 'attached', row.name);
  item.append(el('span', 'sk-arow-name', row.name));
  if (row.missing) {
    const missing = el('span', 'sk-tag sk-warn', msg('skillsExtras.attached.notInstalled'));
    missing.setAttribute('role', 'status');
    missing.dataset.tip = msg('skillsExtras.missing');
    item.append(missing);
  }
  if (onLink) {
    const link = el('button', 'sk-role-act sk-link', msg('skillsExtras.attached.link'));
    link.type = 'button';
    link.tabIndex = -1;
    link.dataset.link = row.name;
    link.dataset.tip = msg('skillsExtras.attached.linkTip');
    link.setAttribute('aria-label', msg('skillsExtras.attached.linkLabel', { name: row.name }));
    link.addEventListener('click', onLink);
    item.append(link);
  }
  if (scoped) item.append(scopeBadge(row.name, row.scope, onMove));
  const detach = el('button', 'sk-x', msg('skillsExtras.attached.detach'));
  detach.type = 'button';
  detach.tabIndex = -1;
  detach.dataset.detach = row.name;
  detach.setAttribute('aria-label', msg('skillsExtras.attached.detachLabel', { name: row.name, role: slotLabel(slot) }));
  detach.addEventListener('click', onDetach);
  item.append(detach);
  return item;
}

interface CandidateHandlers {
  slot: ExtensionSlot;
  scope: ExtensionScope;
  scoped: boolean;
  links: boolean;
  onAttach: () => void;
}

export function candidateItem(row: CandidateRow, { slot, scope, scoped, links, onAttach }: CandidateHandlers) {
  const item = el('button', `sk-crow${row.attached ? ' is-attached' : ''}${row.locked ? ' is-locked' : ''}`);
  item.type = 'button';
  item.tabIndex = -1;
  item.dataset.pick = row.name;
  withFocusKey(item, 'candidate', row.name);
  item.append(el('span', 'sk-crow-name', row.name));
  const free = !row.attached && !row.locked;
  if (row.locked) {
    item.setAttribute('aria-disabled', 'true');
    item.dataset.tip = msg('skillsExtras.attach.builtInTip');
    item.setAttribute('aria-label', `${row.name}. ${msg('skillsExtras.attach.builtInTip')}`);
    item.append(el('span', 'sk-tag', msg('skillsExtras.attach.builtIn')));
  } else if (row.attached) {
    const as = scopeLabel(row.attached);
    item.setAttribute('aria-disabled', 'true');
    item.setAttribute('aria-label', scoped ? msg('skillsExtras.attach.attachedLabel', { name: row.name, role: slotLabel(slot), scope: as }) : msg('skillsExtras.attach.attachedPlainLabel', { name: row.name, role: slotLabel(slot) }));
    item.append(el('span', `sk-tag sk-crow-state is-${row.attached}`, scoped ? msg('skillsExtras.attach.attachedAs', { scope: as }) : msg('skillsExtras.attach.attachedPlain')));
  } else if (links) {
    item.dataset.tip = msg('skillsExtras.attach.notInstalledTip');
    item.setAttribute('aria-label', scoped ? msg('skillsExtras.attach.labelLink', { name: row.name, role: slotLabel(slot), scope: scopeLabel(scope) }) : msg('skillsExtras.attach.labelLinkPlain', { name: row.name, role: slotLabel(slot) }));
    item.append(el('span', 'sk-tag sk-warn', msg('skillsExtras.attached.notInstalled')), el('span', 'sk-crow-act', msg('skillsExtras.attach.actionLink')));
  } else {
    item.setAttribute('aria-label', scoped ? msg('skillsExtras.attach.label', { name: row.name, role: slotLabel(slot), scope: scopeLabel(scope) }) : msg('skillsExtras.attach.labelPlain', { name: row.name, role: slotLabel(slot) }));
    if (!row.installed) item.append(el('span', 'sk-tag sk-warn', msg('skillsExtras.attached.notInstalled')));
    item.append(el('span', 'sk-crow-act', msg('skillsExtras.attach.action')));
  }
  if (free) item.addEventListener('click', onAttach);
  return item;
}

export function lockedRow(name: string) {
  const row = el('div', 'sk-row on locked');
  row.setAttribute('aria-disabled', 'true');
  row.dataset.tip = msg('skillsExtras.lockedTip');
  row.append(el('span', 'sk-check', '✓'), el('span', 'sk-name', name), el('span', 'sk-tag', msg('skillsExtras.locked')));
  return row;
}

export function switchRow(slot: ExtensionSlot, name: string, on: boolean, onToggle: () => void) {
  const row = el('div', `sk-row sk-switch${on ? ' on' : ''}`);
  row.dataset.switch = name;
  row.dataset.tip = msg('skillsExtras.switchTip');
  row.setAttribute('aria-label', msg('skillsExtras.switchLabel', { name, slot: slotLabel(slot) }));
  row.setAttribute('role', 'switch');
  row.setAttribute('aria-checked', String(on));
  row.tabIndex = 0;
  row.addEventListener('click', onToggle);
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onToggle();
  });
  row.append(el('span', 'sk-check', on ? '✓' : ''), el('span', 'sk-name', name), el('span', on ? 'sk-tag' : 'sk-tag sk-warn', msg(on ? 'skillsExtras.on' : 'skillsExtras.off')));
  return row;
}


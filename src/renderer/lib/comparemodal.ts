import CLOSE_ICON from '@renderer/assets/icons/close.svg';
import { WORKTREE, compareId } from '../../shared/local-review';
import type { CompareCommit, CompareRefs, CompareStat } from '../../shared/local-review';
import { mountDropdown } from './comparedropdown';
import type { DropItem, Dropdown } from './comparedropdown';
import { esc } from './lanternctx';
import { plural } from './util';

type Side = 'base' | 'head';

interface CompareApi {
  refs(): Promise<CompareRefs>;
  commits(ref: string): Promise<CompareCommit[]>;
  stat(base: string, head: string): Promise<CompareStat>;
}

interface CompareOptions {
  project: string;
  api: CompareApi;
  onPick(id: string): Promise<void> | void;
}

interface Pick {
  branch: string;
  commit: string;
}

const TITLES: Record<Side, string> = { base: 'Base', head: 'Compare' };
const HINTS: Record<Side, string> = { base: 'What the changes are measured against', head: 'The changes you want to review' };
const SUBJECT_MAX = 60;

function point(pick: Pick) {
  return pick.commit || pick.branch;
}

function pickLabel(pick: Pick) {
  if (pick.branch === WORKTREE) return 'Working tree';
  return pick.commit ? `${pick.branch} @ ${pick.commit.slice(0, 7)}` : pick.branch;
}

function clipText(text: string) {
  return text.length > SUBJECT_MAX ? `${text.slice(0, SUBJECT_MAX - 1)}…` : text;
}

function colHtml(side: Side) {
  return (
    `<section class="cmp-col" data-side="${side}" aria-label="${TITLES[side]}">` +
    `<h3>${TITLES[side]}</h3><p class="cmp-hint">${HINTS[side]}</p>` +
    '<div class="cmp-field" data-cmp-branch></div><div class="cmp-field" data-cmp-commit></div>' +
    '<p class="cmp-detail"></p></section>'
  );
}

function openCompareModal(opts: CompareOptions) {
  const modal = document.createElement('div');
  modal.className = 'modal cmp-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'cmp-title');
  modal.innerHTML =
    '<div class="modal-card cmp-card">' +
    `<div class="modal-head"><span class="modal-title" id="cmp-title">Compare changes</span><span class="modal-proj">${esc(opts.project.split(/[\\/]/).pop() ?? '')}</span><button class="modal-close" data-cmp-close data-tip="Close" aria-label="Close">${CLOSE_ICON}</button></div>` +
    `<div class="cmp-body">${colHtml('base')}<div class="cmp-mid"><button class="cmp-swap" data-cmp-swap data-tip="Swap base and compare" aria-label="Swap base and compare">⇄</button></div>${colHtml('head')}</div>` +
    '<div class="modal-foot cmp-foot"><div class="cmp-summary" role="status" aria-live="polite"></div><span class="spacer"></span><button data-cmp-close>Cancel</button><button class="btn-primary" data-cmp-go disabled>Review</button></div>' +
    '</div>';
  document.body.append(modal);

  const col = (side: Side) => modal.querySelector(`.cmp-col[data-side="${side}"]`) as HTMLElement;
  const field = (side: Side, kind: string) => col(side).querySelector(`[data-cmp-${kind}]`) as HTMLElement;
  const branches = {} as Record<Side, Dropdown>;
  const commitDrops = {} as Record<Side, Dropdown>;
  for (const side of ['base', 'head'] as Side[]) {
    branches[side] = mountDropdown(field(side, 'branch'), 'Branch', (v) => choose(side, { branch: v, commit: '' }));
    commitDrops[side] = mountDropdown(field(side, 'commit'), 'Commit', (v) => choose(side, { ...picks[side], commit: v }));
  }
  const summary = modal.querySelector('.cmp-summary') as HTMLElement;
  const go = modal.querySelector('[data-cmp-go]') as HTMLButtonElement;
  const swap = modal.querySelector('[data-cmp-swap]') as HTMLButtonElement;
  const commits = new Map<string, CompareCommit[] | null>();
  const loading = new Set<string>();
  const picks: Record<Side, Pick> = { base: { branch: '', commit: '' }, head: { branch: WORKTREE, commit: '' } };
  let refs: CompareRefs | null = null;
  let stat: CompareStat | null = null;
  let statToken = 0;
  let busy = false;

  function branchItems(side: Side): DropItem[] {
    if (!refs) return [];
    const tagHtml = (name: string) =>
      [name === refs?.current ? 'current' : '', name === refs?.base ? 'default' : '']
        .filter(Boolean)
        .map((t) => `<span class="cmp-tag">${t}</span>`)
        .join('');
    const rows = refs.branches.map((b) => ({
      value: b.name,
      text: b.name,
      html: `<span class="cmp-row"><span class="cmp-name">${esc(b.name)}${tagHtml(b.name)}</span><span class="cmp-sub">${esc(b.subject)}${b.date ? ` · ${esc(b.date)}` : ''}</span></span>`,
    }));
    if (side === 'base') return rows;
    const dirty = refs.dirty ? plural(refs.dirty, 'uncommitted file') : 'nothing uncommitted';
    return [{ value: WORKTREE, text: 'working tree uncommitted', html: `<span class="cmp-row"><span class="cmp-name cmp-wt">Working tree</span><span class="cmp-sub">Your current files, ${dirty}</span></span>` }, ...rows];
  }

  function commitHtml(subject: string, sha: string, date = '') {
    return `<span class="cmp-crow"${date ? ` data-tip="${esc(date)}"` : ''}><span class="cmp-csubj">${esc(subject)}</span><span class="cmp-sha">${esc(sha)}</span></span>`;
  }

  function commitItems(side: Side): DropItem[] {
    const list = commits.get(picks[side].branch);
    if (!list) return [];
    const tip = list[0];
    return [
      { value: '', text: 'latest tip', html: commitHtml('Latest — follows the branch tip', tip ? tip.short : '') },
      ...list.map((c) => ({ value: c.sha, text: `${c.short} ${c.subject}`, html: commitHtml(c.subject, c.short, c.date) })),
    ];
  }

  function detail(side: Side) {
    const pick = picks[side];
    if (!refs || !pick.branch) return '';
    if (pick.branch === WORKTREE) return `On ${refs.current}, with your uncommitted edits`;
    const c = pick.commit ? commits.get(pick.branch)?.find((x) => x.sha === pick.commit) : commits.get(pick.branch)?.[0];
    const b = refs.branches.find((x) => x.name === pick.branch);
    const subject = c?.subject ?? b?.subject ?? '';
    const date = c?.date ?? b?.date ?? '';
    return subject ? `${subject}${date ? ` · ${date}` : ''}` : '';
  }

  function renderSide(side: Side) {
    const pick = picks[side];
    if (refs) branches[side].set(branchItems(side), pick.branch);
    branches[side].disable(!refs);
    const list = commits.get(pick.branch);
    const empty = pick.branch === WORKTREE ? 'Your current files' : list === null ? 'Could not read the commits' : 'Loading commits…';
    commitDrops[side].set(commitItems(side), pick.commit, empty);
    commitDrops[side].disable(!refs || pick.branch === WORKTREE || !list);
    (col(side).querySelector('.cmp-detail') as HTMLElement).textContent = detail(side);
  }

  function renderSummary() {
    const what = `<span class="cmp-what">${esc(pickLabel(picks.head))} vs ${esc(pickLabel(picks.base))}</span>`;
    if (!refs || !stat) summary.innerHTML = `${what}<span class="cmp-calc">Counting changes…</span>`;
    else if (!stat.ok) summary.innerHTML = `<span class="cmp-err">${esc(stat.error ?? 'Could not compare these two')}</span>`;
    else if (!stat.files) summary.innerHTML = `${what}<span class="cmp-calc">No differences</span>`;
    else summary.innerHTML = `${what}<span class="cmp-num">${plural(stat.files, 'file')}</span><span class="cmp-add">+${stat.add}</span><span class="cmp-del">−${stat.del}</span>`;
    go.disabled = busy || !stat?.ok || !stat.files;
    swap.disabled = picks.head.branch === WORKTREE;
  }

  async function recount() {
    const token = ++statToken;
    stat = null;
    renderSummary();
    let next: CompareStat;
    try {
      next = await opts.api.stat(point(picks.base), point(picks.head));
    } catch {
      next = { ok: false, files: 0, add: 0, del: 0 };
    }
    if (token !== statToken || !modal.isConnected) return;
    stat = next;
    renderSummary();
  }

  async function loadCommits(branch: string) {
    if (branch === WORKTREE || commits.has(branch) || loading.has(branch)) return;
    loading.add(branch);
    let got: CompareCommit[] | null;
    try {
      got = await opts.api.commits(branch);
    } catch {
      got = null;
    }
    loading.delete(branch);
    commits.set(branch, got);
    if (!modal.isConnected) return;
    for (const side of ['base', 'head'] as Side[]) if (picks[side].branch === branch) renderSide(side);
  }

  function choose(side: Side, next: Pick) {
    picks[side] = next;
    renderSide(side);
    void recount();
    void loadCommits(next.branch);
  }

  const opener = document.activeElement as HTMLElement | null;

  function close() {
    statToken++;
    for (const d of [...Object.values(branches), ...Object.values(commitDrops)]) d.dispose();
    document.removeEventListener('keydown', onKey, true);
    modal.remove();
    if (opener?.isConnected) opener.focus();
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    ev.preventDefault();
    const openDrop = [...Object.values(branches), ...Object.values(commitDrops)].find((d) => d.isOpen());
    if (openDrop) openDrop.close();
    else close();
  }

  modal.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    if (t === modal) return close();
    if (t.closest('.cmp-pop')) return;
    const btn = t.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.hasAttribute('data-cmp-close')) close();
    else if (btn.hasAttribute('data-cmp-swap')) {
      [picks.base, picks.head] = [picks.head, picks.base];
      renderSide('base');
      renderSide('head');
      void recount();
    } else if (btn.hasAttribute('data-cmp-go')) {
      busy = true;
      renderSummary();
      try {
        await opts.onPick(compareId(point(picks.base), point(picks.head)));
        close();
      } catch {
        busy = false;
        renderSummary();
      }
    }
  });
  document.addEventListener('keydown', onKey, true);
  (modal.querySelector('[data-cmp-close]') as HTMLElement | null)?.focus();

  renderSummary();
  void opts.api.refs().then(
    (got) => {
      if (!modal.isConnected) return;
      refs = got;
      choose('base', { branch: got.base, commit: '' });
      choose('head', { branch: got.dirty || got.current === got.base || got.current === 'HEAD' ? WORKTREE : got.current, commit: '' });
      branches.head.focus();
    },
    () => {
      if (modal.isConnected) summary.innerHTML = '<span class="cmp-err">Could not read the branches</span>';
    },
  );

  return { close, el: modal };
}

export { openCompareModal };
export type { CompareApi, CompareOptions };

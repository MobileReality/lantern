import { activeProjectPath } from '../state';
import { footBtn, byId, el } from '../lib/util';
import { msg } from '@shared/lang/messages';
import { type AddSkillOpener, mountExtras, mountLinker } from './skills-extras';
import { resetBoardUi } from './skills-roles';
import REFRESH_ICON from '@renderer/assets/icons/refresh.svg';
import { renderAddSkillStep } from './skills-extras-step';
import { BUNDLED_TOOLTIP, LOCAL_TOOLTIP, isLinkable, linkProblems, roleSummary, skillRowKind } from './skills-state';



const skModal = byId('skills-modal');
const skProjEl = byId('sk-proj');
const skBody = byId('sk-body');
const skFoot = byId('sk-foot');
let skData: any = null;
let skNotice: string[] = [];
let skRepoError: string | undefined;
let skRemoteDraft = '';
const TAB_PROJECT = 'project';
const TAB_LANTERN = 'lantern';
const TAB_LINKER = 'linker';
const SK_TABS = [TAB_PROJECT, TAB_LANTERN, TAB_LINKER] as const;
type SkTab = (typeof SK_TABS)[number];
let skTab: SkTab = TAB_PROJECT;
let renderedTab: SkTab | null = null;

async function openSkills() {
  skNotice = [];
  skRepoError = undefined;
  if (skModal.classList.contains('hidden')) {
    skTab = TAB_PROJECT;
    skRemoteDraft = '';
    resetBoardUi();
  }
  skModal.classList.remove('hidden');
  skProjEl.textContent = '';
  skBody.innerHTML = '<div class="sk-msg">Loading…</div>';
  skFoot.innerHTML = '';
  skData = await window.ccmws.skillsList(activeProjectPath());
  renderSkills();
}

function closeSkills() {
  skModal.classList.add('hidden');
}

function renderSkills() {
  const d = skData;
  skModal.classList.toggle('sk-wide', skTab === TAB_LANTERN);
  skProjEl.textContent = d.project ? d.project.name : '';
  const top = renderedTab === skTab ? skBody.scrollTop : 0;
  renderedTab = skTab;
  skBody.innerHTML = '';
  skFoot.innerHTML = '';

  const project: string | null = d.project ? d.project.path : null;
  skBody.appendChild(tabBar());
  const restore = () => {
    skBody.scrollTop = top;
  };
  if (skTab === TAB_LANTERN) {
    renderLanternTab(project).then(restore);
    return;
  }
  if (skTab === TAB_LINKER) {
    renderLinkerTab(project);
    return;
  }

  if (!d.project) {
    skBody.insertAdjacentHTML('beforeend', '<div class="sk-msg"><h3>No project open</h3>Open a project to link skills into it.</div>');
    return closeOnlyFoot();
  }
  if (!d.installed) return renderProjectNeedsRepo(project);

  if (skNotice.length) skBody.appendChild(noticeEl(skNotice));
  renderProjectRoles(d);
  restore();
}

function renderProjectNeedsRepo(project: string | null) {
  const note = el('div', 'sk-msg');
  note.append(el('h3', '', msg('skillsExtras.projectNeedsRepoTitle')), el('div', '', msg('skillsExtras.projectNeedsRepo')));
  const linker = el('div', 'sk-extras');
  skBody.append(note, linker);
  void mountLinker(linker, project, { linkerSaved: refreshSkills });
  skFoot.append(footBtn(msg('skillsExtras.openLinker'), () => selectTab(TAB_LINKER)), el('span', 'spacer'), footBtn('Close', closeSkills));
}

function renderProjectRoles(d: any) {
  const broken = new Set(d.broken);
  const byRole = new Map();
  for (const s of d.available) {
    if (!byRole.has(s.role)) byRole.set(s.role, []);
    byRole.get(s.role).push(s);
  }
  for (const [role, list] of byRole) {
    const names = list.map((s: any) => s.name);
    const { installed, linkable, unlinkable } = roleSummary(names, d);
    const showLink = linkable.length > 0;
    const h = document.createElement('div');
    h.className = 'sk-role';
    const roleName = document.createElement('span');
    roleName.className = 'sk-role-name';
    roleName.textContent = role;
    const count = document.createElement('span');
    count.className = 'sk-role-count';
    count.textContent = `${installed}/${names.length}`;
    const act = document.createElement('button');
    act.className = 'sk-role-act';
    act.textContent = showLink ? 'Link all' : 'Unlink all';
    act.disabled = !showLink && unlinkable.length === 0;
    act.addEventListener('click', (e) => {
      e.stopPropagation();
      applySkills(showLink ? 'link' : 'unlink', showLink ? linkable : unlinkable);
    });
    h.append(roleName, count, act);
    if (role) skBody.appendChild(h);
    for (const s of list) {
      const kind = skillRowKind(s.name, d);
      const on = kind === 'linked' || kind === 'bundled';
      const row = document.createElement('div');
      row.className = 'sk-row' + (on ? ' on' : '') + (broken.has(s.name) ? ' broken' : '') + (kind === 'bundled' || kind === 'local' ? ' locked' : '');
      const check = document.createElement('span');
      check.className = 'sk-check';
      check.textContent = on ? '✓' : '';
      const name = document.createElement('span');
      name.className = 'sk-name';
      name.textContent = s.name;
      row.append(check, name);
      const tag = rowTag(kind, broken.has(s.name));
      if (tag) row.append(tag);
      if (kind === 'bundled') row.dataset.tip = BUNDLED_TOOLTIP;
      if (kind === 'local') row.dataset.tip = LOCAL_TOOLTIP;
      if (kind === 'bundled' || kind === 'local') row.setAttribute('aria-disabled', 'true');
      if (kind === 'available' || kind === 'linked') row.addEventListener('click', () => applySkills(on ? 'unlink' : 'link', [s.name]));
      skBody.appendChild(row);
    }
  }

  const sp = document.createElement('span');
  sp.className = 'spacer';
  const linkableAll = d.available.map((s: any) => s.name).filter((n: string) => isLinkable(n, d));
  skFoot.append(
    footBtn('Link recommended', () => applySkills('link', d.recommended.filter((n: string) => isLinkable(n, d))), 'btn-primary'),
    footBtn('Link all', () => applySkills('link', linkableAll)),
    footBtn('Unlink all', () => applySkills('unlink', d.linked)),
    sp,
    footBtn('Close', closeSkills),
  );
}

function tabBar() {
  const bar = el('div', 'sk-tabs');
  bar.setAttribute('role', 'tablist');
  for (const tab of SK_TABS) {
    const btn = el('button', `sk-tab${tab === skTab ? ' active' : ''}`, msg(`skillsExtras.tabs.${tab}`));
    btn.dataset.skTab = tab;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(tab === skTab));
    btn.addEventListener('click', () => selectTab(tab));
    bar.append(btn);
  }
  return bar;
}

function selectTab(tab: SkTab) {
  skTab = tab;
  skNotice = [];
  renderSkills();
}

function closeOnlyFoot() {
  skFoot.append(el('span', 'spacer'), footBtn('Close', closeSkills));
}

async function renderLanternTab(project: string | null) {
  const host = el('div', 'sk-extras');
  skBody.appendChild(host);
  skFoot.append(footBtn(msg('skillsExtras.refresh'), refreshSkills), el('span', 'spacer'), footBtn('Close', closeSkills));
  await mountExtras(host, project, openAddSkill, [...new Set<string>((skData.available ?? []).map((skill: { name: string }) => skill.name))], { linked: (listing) => (skData = listing) });
}

function renderLinkerTab(project: string | null) {
  const host = el('div', 'sk-extras');
  skBody.appendChild(host);
  void mountLinker(host, project, { linkerSaved: refreshSkills });
  if (skData.installed) {
    closeOnlyFoot();
    skBody.appendChild(renderRepoSettings(skRepoError));
    return;
  }
  const cloneBtn = footBtn('Choose location & clone…', changeRepoLocation, 'btn-primary');
  cloneBtn.dataset.skClone = '';
  const hint = el('div', 'sk-set-note', msg('skillsExtras.cloneNeedsRemote'));
  hint.dataset.skCloneHint = '';
  const syncClone = () => {
    const ready = Boolean(skRemoteDraft.trim() || skData.remote);
    cloneBtn.disabled = !ready;
    hint.hidden = ready;
  };
  skBody.appendChild(clonePrompt(skRepoError, syncClone));
  skBody.appendChild(hint);
  skBody.appendChild(renderRepoSettings());
  syncClone();
  skFoot.append(cloneBtn, el('span', 'spacer'), footBtn('Close', closeSkills));
}

const openAddSkill: AddSkillOpener = ({ slot, taken, locked, scope, scoped }) => {
  skTab = TAB_LANTERN;
  renderAddSkillStep(skBody, skFoot, {
    project: skData.project ? skData.project.path : null,
    slot,
    taken,
    locked,
    scope,
    scoped,
    onBack: showSkillsFresh,
    onSaved: refreshSkills,
  });
};

async function refreshSkills() {
  skData = await window.ccmws.skillsList(activeProjectPath());
  showSkillsFresh();
}

async function applySkills(op: string, names: string[]) {
  if (!skData.project || !names.length) return;
  const project = skData.project.path;
  skData = await (op === 'link' ? window.ccmws.skillsLink(project, names) : window.ccmws.skillsUnlink(project, names));
  skNotice = op === 'link' ? linkProblems(skData.linkResults) : [];
  renderSkills();
}

function showSkillsFresh() {
  skNotice = [];
  renderSkills();
}

function rowTag(kind: string, isBroken: boolean) {
  const label = isBroken ? 'Broken link' : kind === 'bundled' ? 'Bundled with Lantern' : kind === 'local' ? 'Local folder, not managed by Lantern' : '';
  if (!label) return null;
  const t = document.createElement('span');
  t.className = 'sk-tag';
  t.textContent = label;
  return t;
}

function noticeEl(lines: string[]) {
  const el = document.createElement('div');
  el.className = 'sk-msg sk-notice';
  el.textContent = lines.join(' ');
  return el;
}

function clonePrompt(error: string | undefined, onRemoteChange: () => void) {
  const box = el('div', 'sk-msg');
  const cmd = el('div', 'sk-cmd', 'git clone <remote url> <your folder>');
  const remote = document.createElement('input');
  remote.type = 'text';
  remote.className = 'sk-set-field';
  remote.dataset.skRemote = '';
  remote.placeholder = 'https://host/owner/skills.git';
  remote.spellcheck = false;
  remote.setAttribute('aria-label', 'Remote URL of your skills repo');
  remote.value = skRemoteDraft;
  remote.addEventListener('input', () => {
    skRemoteDraft = remote.value;
    onRemoteChange();
  });
  remote.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (skRemoteDraft.trim() || skData.remote)) void changeRepoLocation();
  });
  box.append(el('h3', '', 'Skills repo not found'), el('div', '', 'Enter the remote URL of your skills repo, then choose a folder to clone it into.'), remote, cmd);
  if (error) {
    const failure = el('div', '', `Clone failed: ${error}. Run the command above in a terminal (you may need credentials for your git host).`);
    failure.style.color = 'var(--primary)';
    failure.style.marginTop = '10px';
    box.append(failure);
  }
  return box;
}

function syncButton() {
  const button = el('button', 'sk-sync');
  button.setAttribute('aria-label', 'Sync skills');
  button.dataset.tip = 'Sync — fetch latest version';
  button.dataset.skSync = '';
  button.innerHTML = REFRESH_ICON;
  const glyph = button.querySelector('.sk-sync-glyph')!;
  button.addEventListener('click', async () => {
    glyph.classList.add('spinning');
    const res = await window.ccmws.skillsSync();
    glyph.classList.remove('spinning');
    skData = await window.ccmws.skillsList(activeProjectPath());
    showSkillsFresh();
    if (!res.ok) {
      const e = document.createElement('div');
      e.className = 'sk-msg';
      e.style.color = 'var(--primary)';
      e.style.padding = '8px 12px';
      e.textContent = `Sync failed: ${res.error}`;
      skBody.prepend(e);
    }
  });
  return button;
}

function settingsRow(label: string, value?: string, action?: HTMLElement) {
  const r = document.createElement('div');
  r.className = 'sk-set-row';
  const l = document.createElement('span');
  l.className = 'sk-set-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'sk-set-val';
  v.textContent = value || '—';
  v.dataset.tip = value || '';
  r.append(l, v);
  if (action) r.append(action);
  return r;
}

function showRepoError(error?: string) {
  skRepoError = error;
  renderSkills();
}

function renderRepoSettings(error?: string) {
  const wrap = document.createElement('div');
  wrap.className = 'sk-settings';

  const field = document.createElement('div');
  field.className = 'sk-set-input';
  const label = document.createElement('span');
  label.className = 'sk-set-label';
  label.textContent = 'Skills repo';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sk-set-field';
  input.value = skData.repo || '';
  input.placeholder = '/path/to/skills';
  input.spellcheck = false;
  const apply = document.createElement('button');
  apply.className = 'sk-role-act';
  apply.textContent = 'Apply';
  const submit = () => applyRepoLocation(input.value.trim(), showRepoError);
  apply.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  field.append(label, input, apply);
  wrap.append(field, settingsRow('Remote', skData.remote), settingsRow('Version', skData.version, skData.installed ? syncButton() : undefined), settingsRow('Status', skData.installed ? 'found' : 'not found'));

  if (error) {
    const e = document.createElement('div');
    e.className = 'sk-set-err';
    e.textContent = `Failed: ${error}`;
    wrap.append(e);
  }
  const note = document.createElement('div');
  note.className = 'sk-set-note';
  note.textContent =
    'Type/paste a path and Apply, or use Browse… — the app adopts an existing skills checkout there, or clones your remote into it. The path is remembered.';
  const actions = el('div', 'sk-set-actions');
  actions.append(footBtn('Browse…', () => changeRepoLocation(), 'sk-role-act'), footBtn('Open folder', () => window.ccmws.skillsReveal(), 'sk-role-act'));
  if (skData.repoFromLinker) wrap.append(el('div', 'sk-set-note', msg('skillsExtras.repoFromLinker')));
  wrap.append(note, actions);
  return wrap;
}

async function applyRepoLocation(dir: string | null, onError: (error?: string) => void) {
  if (!dir) return;
  skRepoError = undefined;
  skBody.replaceChildren(el('div', 'sk-msg', `Setting up ${dir}…`));
  skFoot.replaceChildren();
  const res = await window.ccmws.skillsClone(dir, skRemoteDraft.trim());
  skData = await window.ccmws.skillsList(activeProjectPath());
  if (res.ok) showSkillsFresh();
  else onError(res.error);
}

async function changeRepoLocation() {
  const dir = await window.ccmws.skillsChooseDir();
  applyRepoLocation(dir, showRepoError);
}

const micBtn = byId('mic-btn') as HTMLButtonElement;
const micLabel = micBtn.querySelector('.mic-fix-label') as HTMLElement;
async function fixMicrophone() {
  if (micBtn.disabled) return;
  const label = micLabel.textContent;
  micBtn.disabled = true;
  micBtn.setAttribute('aria-busy', 'true');
  const confirmed = await window.ccmws.fixMic();
  if (!confirmed) {
    micBtn.disabled = false;
    micBtn.removeAttribute('aria-busy');
    return;
  }
  micLabel.textContent = 'Enabled ✓ — reopen tab';
  setTimeout(() => {
    micLabel.textContent = label;
    micBtn.disabled = false;
    micBtn.removeAttribute('aria-busy');
  }, 4000);
}

window.addEventListener('mr:provider-changed', () => {
  if (!skModal.classList.contains('hidden')) void openSkills();
});
byId('sk-close').addEventListener('click', closeSkills);
skModal.addEventListener('click', (e) => {
  if (e.target === skModal) closeSkills();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !skModal.classList.contains('hidden')) closeSkills();
});

export { fixMicrophone, openSkills };

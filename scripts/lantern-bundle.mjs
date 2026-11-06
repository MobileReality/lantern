import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { offEverywhere } from '../skills/lantern-delegate/scripts/bundled-skills.mjs';
import { DELEGATE_AGENT_PREFIX } from '../skills/lantern-delegate/scripts/delegate-kinds.mjs';
import { EXTENSIONS_FILE, EXTENSIONS_FOLDER, readSwitchedOff } from '../skills/lantern-delegate/scripts/extensions.mjs';

const SKILL_MARKER = '.lantern-bundle';
const AGENTS_MARKER = '.lantern-bundle-agents';
const BUNDLE_SKILLS = [
  { name: 'lantern-setup', skip: { claude: ['example-web'], codex: ['example-web', 'agents'] } },
  { name: 'lantern-sync', skip: [] },
  { name: 'lantern-delegate', skip: ['agents', 'presets'] },
  { name: 'lantern-delegate-complex', skip: ['agents'] },
  { name: 'lantern-plan', skip: [] },
  { name: 'lantern-plan-impact', skip: [] },
  { name: 'lantern-plan-stages', skip: [] },
  { name: 'lantern-plan-review', skip: [] },
  { name: 'lantern-plan-handoff', skip: [] },
  { name: 'lantern-commit', skip: [] },
  { name: 'lantern-local-loop', skip: [] },
  { name: 'lantern-no-comments', skip: [] },
  { name: 'lantern-code-reviewer', skip: [] },
  { name: 'lantern-jira', skip: [] },
  { name: 'lantern-bitbucket', skip: [] },
  { name: 'lantern-github', skip: [] },
];
const OBSOLETE_SKILLS = ['commit', 'no-comments', 'local-loop', 'code-reviewer', 'delegate-lantern'];
const OBSOLETE_AGENTS = ['delegate-lantern-low.md', 'delegate-lantern-medium.md', 'delegate-lantern-high.md', 'delegate-lantern-xhigh.md'];
const PROVIDERS = {
  claude: { skills: ['.claude', 'skills'] },
  codex: { skills: ['.agents', 'skills'], only: ['lantern-setup', 'lantern-sync', 'lantern-delegate', 'lantern-jira', 'lantern-bitbucket', 'lantern-github'] },
};
const ALWAYS_IN_PROJECT = ['reviewer.md', 'reviewer-complex.md'];
const AGENTS_SKILL = 'lantern-delegate';
const AGENT_SKILLS = [AGENTS_SKILL, 'lantern-delegate-complex', 'lantern-setup'];
const DELEGATE_AGENTS_GLOB = `.claude/agents/${DELEGATE_AGENT_PREFIX}*.md`;
const CLAUDE_AGENTS = ['.claude', 'agents'];
const AGENTS_GUARD_PATH = `.claude/agents/${AGENTS_MARKER}`;
const SETTINGS_LOCAL = ['.claude', 'settings.local.json'];
const SETTINGS_LOCAL_REL = SETTINGS_LOCAL.join('/');
const EXTENSIONS_FILE_REL = [EXTENSIONS_FOLDER, EXTENSIONS_FILE].join('/');
const PERMISSIONS_SCRIPTS = [AGENTS_SKILL, 'scripts'];
const GIT_TIMEOUT_MS = 15_000;
const INHERITED_GIT_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'];

function entry(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function isRealDirOrMissing(p) {
  const e = entry(p);
  return !e || e.isDirectory();
}

function isSameDir(a, b) {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return false;
  }
}

function listFiles(dir, skip = []) {
  const out = [];
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (!rel && skip.includes(d.name)) continue;
      if (d.name === '.DS_Store') continue;
      const relPath = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(relPath);
      else if (d.isFile()) out.push(relPath);
    }
  };
  walk('');
  return out.sort();
}

function hashFiles(dir, files) {
  const hash = crypto.createHash('sha256');
  for (const rel of files) {
    hash.update(`${rel}\0`);
    hash.update(fs.readFileSync(path.join(dir, ...rel.split('/'))));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function hashAgentSources(sources) {
  const hash = crypto.createHash('sha256');
  for (const [name, dir] of sources) {
    hash.update(`${name}\0`);
    hash.update(fs.readFileSync(path.join(dir, name)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function copyFiles(source, dest, files) {
  for (const rel of files) {
    const target = path.join(dest, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, ...rel.split('/')), target);
  }
}

function providerConfig(provider) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`unsupported provider ${provider}`);
  return config;
}

function providerSkills(provider, skills) {
  const { only } = providerConfig(provider);
  return only ? skills.filter((name) => only.includes(name)) : skills;
}

function nativePath(base, segments) {
  return path.join(base, ...segments);
}

function homeNativePaths(home, codexHome, config, kind) {
  if (config !== PROVIDERS.codex) return [nativePath(home, config[kind])];
  return [path.join(home, '.agents', 'skills'), path.join(codexHome, 'skills')];
}

function isSafeNativePath(base, segments) {
  let current = base;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!isRealDirOrMissing(current)) return false;
  }
  return true;
}

function writeSkillCopy(source, dest, files, hash) {
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.lantern-${process.pid}-${Date.now()}`);
  try {
    copyFiles(source, tmp, files);
    fs.writeFileSync(path.join(tmp, SKILL_MARKER), `${hash}\n`);
    if (entry(dest)) fs.rmSync(dest, { recursive: true });
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

function removeObsoleteSkills(project, config) {
  if (!isSafeNativePath(project, config.skills)) return [];
  const removed = [];
  for (const name of OBSOLETE_SKILLS) {
    const dest = path.join(nativePath(project, config.skills), name);
    if (!entry(dest)?.isDirectory() || !entry(path.join(dest, SKILL_MARKER))?.isFile()) continue;
    fs.rmSync(dest, { recursive: true });
    removed.push(name);
  }
  return removed;
}

function switchedOffSkills(home) {
  try {
    return offEverywhere(readSwitchedOff(home));
  } catch {
    return [];
  }
}

function removeSwitchedOffSkills(project, config, names) {
  if (!isSafeNativePath(project, config.skills)) return [];
  return names.filter((name) => {
    const dest = path.join(nativePath(project, config.skills), name);
    if (!entry(dest)?.isDirectory() || !entry(path.join(dest, SKILL_MARKER))?.isFile()) return false;
    fs.rmSync(dest, { recursive: true });
    return true;
  });
}

function removeObsoleteAgents(project) {
  if (!isSafeNativePath(project, CLAUDE_AGENTS)) return;
  const dir = nativePath(project, CLAUDE_AGENTS);
  const markerPath = path.join(dir, AGENTS_MARKER);
  const marker = entry(markerPath)?.isFile() ? parseAgentsMarker(markerPath) : null;
  if (!marker) return;
  const removed = OBSOLETE_AGENTS.filter((name) => marker.names.includes(name) && (!entry(path.join(dir, name)) || entry(path.join(dir, name)).isFile()));
  for (const name of removed) fs.rmSync(path.join(dir, name), { force: true });
  if (removed.length) fs.writeFileSync(markerPath, `${marker.hash}\n${marker.names.filter((n) => !removed.includes(n)).join('\n')}\n`);
}

function installSkill({ project, home, codexHome, root, spec, config, provider }) {
  const source = path.join(root, spec.name);
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) return 'missing-source';
  const dest = path.join(nativePath(project, config.skills), spec.name);
  const existing = entry(dest);
  const skip = Array.isArray(spec.skip) ? spec.skip : spec.skip[provider];
  const files = listFiles(source, skip);
  const hash = hashFiles(source, files);
  if (!existing) {
    if (homeNativePaths(home, codexHome, config, 'skills').some((dir) => entry(path.join(dir, spec.name)))) return 'home';
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    writeSkillCopy(source, dest, files, hash);
    return 'installed';
  }
  if (existing.isSymbolicLink()) return 'symlink';
  if (!existing.isDirectory()) return 'unmarked';
  const marker = path.join(dest, SKILL_MARKER);
  if (!entry(marker)?.isFile()) return 'unmarked';
  if (fs.readFileSync(marker, 'utf8').trim() === hash) return 'current';
  writeSkillCopy(source, dest, files, hash);
  return 'refreshed';
}

function parseAgentsMarker(file) {
  if (!entry(file)?.isFile()) return null;
  const [hash = '', ...names] = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  return { hash, names };
}

function agentSources(root) {
  const byName = new Map();
  for (const skill of AGENT_SKILLS) {
    const dir = path.join(root, skill, 'agents');
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isFile() && d.name.endsWith('.md') && !byName.has(d.name)) byName.set(d.name, dir);
    }
  }
  return [...byName].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function listAgentNames(root) {
  return agentSources(root).map(([name]) => name);
}

function installAgents({ project, home, root, allowed, adopt = [] }) {
  const sources = agentSources(root);
  const names = sources.map(([name]) => name);
  const sourceDir = new Map(sources);
  if (!names.length) return { status: 'missing-source', files: [] };
  const hash = hashAgentSources(sources);
  const dir = nativePath(project, CLAUDE_AGENTS);
  const markerPath = path.join(dir, AGENTS_MARKER);
  const markerEntry = entry(markerPath);
  if (markerEntry && !markerEntry.isFile()) return { status: 'symlink', files: [] };
  const marker = parseAgentsMarker(markerPath);
  const isWanted = (n) => !allowed || allowed.includes(n);
  const homeHas = (n) => Boolean(entry(path.join(nativePath(home, CLAUDE_AGENTS), n)));
  const isAdoptable = (n, owned) => adopt.includes(n) && !owned.includes(n) && !homeHas(n);
  const lacksRequired = names.some((n) => {
    if (!isWanted(n)) return false;
    if (entry(path.join(dir, n))) return isAdoptable(n, marker?.names ?? []);
    if (ALWAYS_IN_PROJECT.includes(n)) return true;
    return !marker?.names.includes(n) && !entry(path.join(nativePath(home, CLAUDE_AGENTS), n));
  });
  if (marker?.hash === hash && !lacksRequired) return { status: 'current', files: [] };
  const owned = new Set(marker ? marker.names.filter((n) => names.includes(n)) : []);
  const written = [];
  for (const name of names) {
    if (!isWanted(name)) continue;
    const dest = path.join(dir, name);
    const existing = entry(dest);
    if (existing) {
      if (!existing.isFile()) continue;
      if (!owned.has(name)) {
        if (!isAdoptable(name, [...owned])) continue;
        owned.add(name);
      }
      fs.copyFileSync(path.join(sourceDir.get(name), name), dest);
      written.push(name);
    } else if (ALWAYS_IN_PROJECT.includes(name) || !entry(path.join(nativePath(home, CLAUDE_AGENTS), name))) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(sourceDir.get(name), name), dest, fs.constants.COPYFILE_EXCL);
      owned.add(name);
      written.push(name);
    }
  }
  if (!marker && !written.length) return { status: 'kept', files: [] };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerPath, `${hash}\n${[...owned].sort().join('\n')}\n`);
  return { status: marker ? 'refreshed' : 'installed', files: written };
}

function installBundle({ project, root, home = os.homedir(), codexHome = process.env.CODEX_HOME || path.join(home, '.codex'), provider = 'claude', skills = BUNDLE_SKILLS.map((s) => s.name), agents = true, adopt = [], off = switchedOffSkills(home) }) {
  const config = providerConfig(provider);
  const result = { skipped: null, skills: {}, agents: null, obsolete: [] };
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) return { ...result, skipped: 'not-a-directory' };
  if (isSameDir(project, home) || (provider === 'codex' && isSameDir(project, codexHome))) return { ...result, skipped: 'home' };
  const asked = providerSkills(provider, skills);
  const wanted = asked.filter((name) => !off.includes(name));
  if (wanted.length) result.obsolete = removeObsoleteSkills(project, config);
  const removedOff = new Set(removeSwitchedOffSkills(project, config, asked.filter((name) => off.includes(name))));
  for (const spec of BUNDLE_SKILLS) {
    if (asked.includes(spec.name) && off.includes(spec.name)) result.skills[spec.name] = removedOff.has(spec.name) ? 'removed-off' : 'off';
    if (!wanted.includes(spec.name)) continue;
    result.skills[spec.name] = isSafeNativePath(project, config.skills) ? installSkill({ project, home, codexHome, root, spec, config, provider }) : 'symlink';
  }
  if (provider === 'claude' && agents) removeObsoleteAgents(project);
  if (provider === 'claude' && agents) result.agents = isSafeNativePath(project, CLAUDE_AGENTS) ? installAgents({ project, home, root, allowed: Array.isArray(agents) ? agents : null, adopt }) : { status: 'symlink', files: [] };
  return result;
}

function gitEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  for (const name of INHERITED_GIT_VARS) delete env[name];
  return env;
}

function gitIgnores(project, rel) {
  return new Promise((resolve) => {
    try {
      execFile('git', ['-C', project, 'check-ignore', '-q', rel], { timeout: GIT_TIMEOUT_MS, env: gitEnv(), windowsHide: true }, (error) => resolve(!error));
    } catch {
      resolve(false);
    }
  });
}

async function ignoredAmong(project, names, dir) {
  const flags = await Promise.all(names.map((name) => gitIgnores(project, `${dir}/${name}`)));
  return names.filter((_, i) => flags[i]);
}

function gitOut(project, args) {
  return new Promise((resolve) => {
    try {
      execFile('git', ['-C', project, ...args], { timeout: GIT_TIMEOUT_MS, env: gitEnv(), windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout).trim()));
    } catch {
      resolve(null);
    }
  });
}

function isInsideGitRepo(project) {
  let dir;
  try {
    dir = fs.realpathSync.native(project);
  } catch {
    dir = path.resolve(project);
  }
  for (;;) {
    if (entry(path.join(dir, '.git'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function excludeLines(skillDir, skills, agentNames, allAgentNames = agentNames) {
  const lines = skillDir === PROVIDERS.claude.skills.join('/') ? [AGENTS_GUARD_PATH] : [];
  const delegates = allAgentNames.filter((n) => n.startsWith(DELEGATE_AGENT_PREFIX));
  const globbed = delegates.length > 0 && delegates.every((n) => agentNames.includes(n));
  if (globbed) lines.push(DELEGATE_AGENTS_GLOB);
  for (const name of agentNames) if (!(globbed && delegates.includes(name))) lines.push(`.claude/agents/${name}`);
  return [...lines, ...skills.map((name) => `${skillDir}/${name}`)];
}

function claimableAgents({ project, home, names }) {
  const dir = nativePath(project, CLAUDE_AGENTS);
  const owned = parseAgentsMarker(path.join(dir, AGENTS_MARKER))?.names ?? [];
  return names.filter((name) => {
    if (entry(path.join(dir, name))) return owned.includes(name);
    return ALWAYS_IN_PROJECT.includes(name) || !entry(path.join(nativePath(home, CLAUDE_AGENTS), name));
  });
}

async function excludeBundlePaths({ project, home = os.homedir(), skillDir, skills, agentNames, allAgentNames = agentNames, lines = excludeLines(skillDir, skills, agentNames, allAgentNames) }) {
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory() || isSameDir(project, home)) return false;
  if (!isRealDirOrMissing(path.join(project, skillDir.split('/')[0]))) return false;
  const top = await gitOut(project, ['rev-parse', '--show-toplevel']);
  if (!top || !isSameDir(top, project)) return false;
  const rel = await gitOut(project, ['rev-parse', '--git-path', 'info/exclude']);
  if (!rel) return false;
  const file = path.resolve(project, rel);
  const existing = entry(file);
  if (existing && !existing.isFile()) return false;
  const current = existing ? fs.readFileSync(file, 'utf8') : '';
  const have = new Set(current.split('\n').map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (!missing.length) return true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  return true;
}

async function probeIgnored(project, skillDir, skills, agentNames, agents) {
  const [allowedSkills, allowedAgents, markerIgnored] = await Promise.all([
    ignoredAmong(project, skills, skillDir),
    ignoredAmong(project, agentNames, CLAUDE_AGENTS.join('/')),
    agents ? gitIgnores(project, AGENTS_GUARD_PATH) : false,
  ]);
  return { allowedSkills, allowedAgents, agentsAllowed: markerIgnored && allowedAgents.length > 0 };
}

async function loadDelegateRules(root, project, home) {
  const scripts = path.join(root, ...PERMISSIONS_SCRIPTS);
  const permissionsFile = path.join(scripts, 'permissions.mjs');
  if (!entry(permissionsFile)?.isFile()) return null;
  const permissions = await import(pathToFileURL(permissionsFile).href);
  let skillLinker;
  const skillLinkerFile = path.join(scripts, 'skill-linker.mjs');
  if (entry(skillLinkerFile)?.isFile()) skillLinker = (await import(pathToFileURL(skillLinkerFile).href)).resolveSkillLinker({ home }).path ?? undefined;
  const skillRoots = [path.join(project, '.claude', 'skills'), path.join(home, '.claude', 'skills')];
  return JSON.parse(permissions.settingsSnippet({ skillRoots, skillLinker })).permissions;
}

function mergeRules(current, wanted) {
  if (current === undefined) return wanted.length ? [...wanted] : undefined;
  if (!Array.isArray(current)) return null;
  const missing = wanted.filter((rule) => !current.includes(rule));
  return missing.length ? [...current, ...missing] : current;
}

function mergeSettings(settings, rules) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const permissions = settings.permissions ?? {};
  if (typeof permissions !== 'object' || Array.isArray(permissions)) return null;
  const allow = mergeRules(permissions.allow, rules.allow);
  const deny = mergeRules(permissions.deny, rules.deny);
  if (allow === null || deny === null) return null;
  const changed = allow !== permissions.allow || deny !== permissions.deny;
  return { changed, settings: { ...settings, permissions: { ...permissions, allow, deny } } };
}

function writeSettingsFile(file, settings) {
  const tmp = `${file}.lantern-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

async function installPermissions({ project, root, home = os.homedir(), consent }) {
  const canonicalProject = fs.realpathSync.native(project);
  if (!isSafeNativePath(canonicalProject, ['.claude'])) return { status: 'symlink' };
  const file = path.join(canonicalProject, ...SETTINGS_LOCAL);
  const existing = entry(file);
  if (existing && !existing.isFile()) return { status: 'symlink' };
  const rules = await loadDelegateRules(root, canonicalProject, home);
  if (!rules) return { status: 'missing-source' };
  if (isInsideGitRepo(canonicalProject) && !(await gitIgnores(canonicalProject, SETTINGS_LOCAL_REL))) {
    await excludeBundlePaths({ project: canonicalProject, home, skillDir: PROVIDERS.claude.skills.join('/'), skills: [], agentNames: [], lines: [SETTINGS_LOCAL_REL] });
    if (!(await gitIgnores(canonicalProject, SETTINGS_LOCAL_REL))) return { status: 'not-ignored' };
  }
  if (isInsideGitRepo(canonicalProject) && !(await gitIgnores(canonicalProject, EXTENSIONS_FILE_REL))) {
    await excludeBundlePaths({ project: canonicalProject, home, skillDir: PROVIDERS.claude.skills.join('/'), skills: [], agentNames: [], lines: [EXTENSIONS_FILE_REL] });
  }
  const plan = () => {
    const present = entry(file);
    if (present && !present.isFile()) return { status: 'symlink' };
    let current = {};
    if (present) {
      try {
        current = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return { status: 'unparseable' };
      }
    }
    const merged = mergeSettings(current, rules);
    if (!merged) return { status: 'unparseable' };
    if (present && !merged.changed) return { status: 'current' };
    return { merged, addsAllow: merged.settings.permissions.allow !== current.permissions?.allow };
  };
  let step = plan();
  if (!step.merged) return step;
  if (consent && step.addsAllow) {
    if (!(await consent())) return { status: 'no-consent' };
    step = plan();
    if (!step.merged) return step;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeSettingsFile(file, step.merged.settings);
  return { status: 'written' };
}

async function syncDelegatePermissions({ project, root, home = os.homedir(), consent }) {
  try {
    if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) return { status: 'not-a-directory' };
    if (isSameDir(project, home)) return { status: 'home' };
    return await installPermissions({ project, root, home, consent });
  } catch {
    return { status: 'failed' };
  }
}

function isClaimable({ project, home, codexHome, root, name, config }) {
  if (!fs.existsSync(path.join(root, name, 'SKILL.md'))) return false;
  const dest = path.join(nativePath(project, config.skills), name);
  const existing = entry(dest);
  if (!existing) return !homeNativePaths(home, codexHome, config, 'skills').some((dir) => entry(path.join(dir, name)));
  return existing.isDirectory() && Boolean(entry(path.join(dest, SKILL_MARKER))?.isFile());
}

function skippedEntries(result, provider = 'claude') {
  const skillDir = providerConfig(provider).skills.join('/');
  const reason = (rel) => `git does not ignore ${rel} and the repo-local .git/info/exclude could not make it ignored`;
  const skills = Object.entries(result.skills ?? {})
    .filter(([, status]) => status === 'not-ignored')
    .map(([name]) => ({ name, reason: reason(`${skillDir}/${name}`) }));
  const agents = (result.agentsSkipped ?? []).map((name) => ({ name, reason: reason(`${CLAUDE_AGENTS.join('/')}/${name}`) }));
  return [...skills, ...agents];
}

async function installSkillsGuarded({ provider = 'claude', skills: requested = BUNDLE_SKILLS.map((s) => s.name), agents = true, ...rest }) {
  const config = providerConfig(provider);
  const skillDir = config.skills.join('/');
  const home = rest.home ?? os.homedir();
  const off = rest.off ?? switchedOffSkills(home);
  const asked = providerSkills(provider, requested);
  const skills = asked.filter((name) => !off.includes(name));
  if (!isInsideGitRepo(rest.project)) return installBundle({ ...rest, provider, skills: asked, agents, off });
  const wantAgents = provider === 'claude' && agents;
  const agentNames = wantAgents ? listAgentNames(rest.root) : [];
  const codexHome = rest.codexHome ?? (process.env.CODEX_HOME || path.join(home, '.codex'));
  const claimable = new Set(skills.filter((name) => isClaimable({ project: rest.project, home, codexHome, root: rest.root, name, config })));
  const probeAll = () => probeIgnored(rest.project, skillDir, skills, agentNames, wantAgents);
  let probe = await probeAll();
  const unexcluded = skills.filter((name) => claimable.has(name) && !probe.allowedSkills.includes(name));
  const claimableAgentNames = claimableAgents({ project: rest.project, home, names: agentNames });
  const agentsOpen = claimableAgentNames.length > 0 && (!probe.agentsAllowed || claimableAgentNames.some((name) => !probe.allowedAgents.includes(name)));
  if ((unexcluded.length || agentsOpen) && (await excludeBundlePaths({ project: rest.project, home, skillDir, skills: unexcluded, agentNames: agentsOpen ? claimableAgentNames : [], allAgentNames: agentNames }))) {
    probe = await probeAll();
  }
  const { allowedSkills, allowedAgents, agentsAllowed } = probe;
  const offAsked = asked.filter((name) => off.includes(name));
  const offIgnored = await ignoredAmong(rest.project, offAsked, skillDir);
  const offLeft = offAsked.filter((name) => !offIgnored.includes(name));
  const nothingAllowed = !allowedSkills.length && !agentsAllowed;
  const notIgnored = skills.filter((name) => !allowedSkills.includes(name));
  const inspected = nothingAllowed ? [] : notIgnored.filter((name) => !claimable.has(name));
  const result = installBundle({ ...rest, provider, skills: [...allowedSkills, ...inspected, ...offIgnored], agents: agentsAllowed ? allowedAgents : false, off });
  if (result.skipped) return result;
  for (const name of offLeft) result.skills[name] = entry(path.join(nativePath(rest.project, config.skills), name)) ? 'not-ignored' : 'off';
  for (const name of notIgnored) if (!inspected.includes(name)) result.skills[name] = 'not-ignored';
  const agentsLeft = claimableAgentNames.filter((name) => !agentsAllowed || !allowedAgents.includes(name));
  if (agentsLeft.length) result.agentsSkipped = agentsLeft;
  if (nothingAllowed) result.skipped = 'not-ignored';
  return result;
}

async function ensureIgnored(project, rel, { home = os.homedir() } = {}) {
  const canonicalProject = fs.realpathSync.native(project);
  if (!isInsideGitRepo(canonicalProject) || (await gitIgnores(canonicalProject, rel))) return 'ignored';
  await excludeBundlePaths({ project: canonicalProject, home, skillDir: PROVIDERS.claude.skills.join('/'), skills: [], agentNames: [], lines: [rel] });
  return (await gitIgnores(canonicalProject, rel)) ? 'ignored' : 'not-ignored';
}

async function installBundleGuarded(options) {
  const result = await installSkillsGuarded(options);
  if ((options.provider ?? 'claude') !== 'claude' || result.skipped === 'home' || result.skipped === 'not-a-directory') return result;
  result.permissions = await syncDelegatePermissions({ project: options.project, root: options.root, home: options.home, consent: options.consent });
  return result;
}

export { AGENTS_MARKER, BUNDLE_SKILLS, OBSOLETE_AGENTS, OBSOLETE_SKILLS, PROVIDERS, SKILL_MARKER, ensureIgnored, gitIgnores, installBundle, installBundleGuarded, skippedEntries, syncDelegatePermissions };

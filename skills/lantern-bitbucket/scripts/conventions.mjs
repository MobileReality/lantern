import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillError } from './http.mjs';
import { message } from './messages.mjs';

export const SOURCE = Object.freeze({ repository: 'repository', skill: 'skill', saved: 'saved' });
export const LOCATION = Object.freeze({ file: 'file', folder: 'folder' });
export const TEMPLATE_ACTION = Object.freeze({ save: 'save', show: 'show' });

const SKILL_ROOTS = Object.freeze([
  { base: 'project', parts: ['.claude', 'skills'] },
  { base: 'project', parts: ['.agents', 'skills'] },
  { base: 'home', parts: ['.claude', 'skills'] },
  { base: 'home', parts: ['.agents', 'skills'] },
]);
const SOURCE_LABEL = Object.freeze({ repository: 'conventions.source.repository', skill: 'conventions.source.skill', saved: 'conventions.source.saved' });
const SAVED_FOLDER = Object.freeze(['.claude', 'lantern-templates']);
const BUNDLE_SKILL = /(^|-)lantern(-|$)/;
const TOPIC = /pull[- ]?requests?|\bPRs?\b|tickets?|issues?|jira|bitbucket|github/i;
const TEMPLATE_FILE = /\.(md|ya?ml)$/i;
const IGNORED_FILES = new Set(['config.yml', 'config.yaml']);
const MARKER_LINE = /^(name|description):\s*(.*)$/;
const BLOCK_SCALAR = /^[>|][+-]?$/;
const HEAD_BYTES = 4096;
const LINE_MAX = 160;

const isFile = (path) => existsSync(path) && statSync(path).isFile();
const isFolder = (path) => existsSync(path) && statSync(path).isDirectory();
const unquote = (text) => text.trim().replace(/^(["'])(.*)\1$/, '$2');
const oneLine = (text) => (text.length > LINE_MAX ? `${text.slice(0, LINE_MAX - 3)}...` : text);
const identity = (path) => realpathSync.native(path).toLowerCase();

function findProject(cwd) {
  let at = resolve(cwd);
  for (;;) {
    if (existsSync(join(at, '.git'))) return at;
    const parent = dirname(at);
    if (parent === at) return resolve(cwd);
    at = parent;
  }
}

function frontmatter(file) {
  const head = readFileSync(file, 'utf8').slice(0, HEAD_BYTES).split('\n');
  const found = {};
  if (head[0]?.trim() !== '---') return found;
  for (let i = 1; i < head.length && head[i].trim() !== '---'; i += 1) {
    const match = MARKER_LINE.exec(head[i]);
    if (!match) continue;
    const value = BLOCK_SCALAR.test(match[2].trim()) ? (head[i + 1] ?? '') : match[2];
    found[match[1]] = unquote(value);
  }
  return found;
}

function shown(path, project, home) {
  const real = resolve(path);
  if (real === project || real.startsWith(project + sep)) return relative(project, real);
  if (real.startsWith(home + sep)) return join('~', relative(home, real));
  return real;
}

function repositoryCandidates(config, project) {
  return config.repoLocations.flatMap(({ path, type }) => {
    const target = join(project, path);
    const files = type === LOCATION.folder && isFolder(target)
      ? readdirSync(target).filter((name) => TEMPLATE_FILE.test(name) && !IGNORED_FILES.has(name)).sort().map((name) => join(path, name))
      : type === LOCATION.file && isFile(target) ? [path] : [];
    return files.map((file) => ({ source: SOURCE.repository, name: basename(file), path: file, description: message('conventions.repoLine'), key: identity(join(project, file)) }));
  });
}

function skillCandidates(project, home) {
  const bases = { project, home };
  return SKILL_ROOTS.flatMap(({ base, parts }) => {
    const root = join(bases[base], ...parts);
    if (!isFolder(root)) return [];
    return readdirSync(root).sort().flatMap((folder) => {
      const file = join(root, folder, 'SKILL.md');
      if (BUNDLE_SKILL.test(folder) || !isFile(file)) return [];
      const { name = folder, description = '' } = frontmatter(file);
      if (BUNDLE_SKILL.test(name) || !TOPIC.test(`${name} ${description}`)) return [];
      return [{ source: SOURCE.skill, name, path: shown(file, project, home), description: oneLine(description) || message('conventions.noDescription'), key: identity(file) }];
    });
  });
}

function savedFile(host, kind) {
  return `${host}-${kind}.md`;
}

function savedCandidates(host, project) {
  const folder = join(project, ...SAVED_FOLDER);
  if (!isFolder(folder)) return [];
  return readdirSync(folder).filter((name) => name.startsWith(`${host}-`) && name.endsWith('.md')).sort().map((name) => ({
    source: SOURCE.saved,
    name,
    path: join(...SAVED_FOLDER, name),
    description: message('conventions.savedLine', { kind: name.slice(host.length + 1, -3) }),
    key: identity(join(folder, name)),
  }));
}

export function createConventions(config) {
  const host = basename(fileURLToPath(new URL('..', import.meta.url))).replace(/^lantern-/, '');
  const contextOf = ({ cwd, env }) => ({ project: findProject(cwd), home: resolve(env?.HOME ?? env?.USERPROFILE ?? homedir()) });

  function list(context) {
    const { project, home } = contextOf(context);
    const seen = new Set();
    const candidates = [...repositoryCandidates(config, project), ...skillCandidates(project, home), ...savedCandidates(host, project)]
      .filter(({ key }) => !seen.has(key) && seen.add(key))
      .map(({ key, ...rest }) => rest);
    if (context.options.json) return [JSON.stringify(candidates, null, 2)];
    if (!candidates.length) return [message('conventions.none')];
    return candidates.map((one) => message('conventions.row', { source: message(SOURCE_LABEL[one.source]), path: one.path, line: one.description }));
  }

  function template(context) {
    const { action, kind } = context.positionals;
    if (!Object.values(TEMPLATE_ACTION).includes(action)) throw new SkillError(message('template.badAction', { actions: Object.values(TEMPLATE_ACTION).join(', ') }));
    if (!config.kinds.includes(kind)) throw new SkillError(message('template.badKind', { kind, kinds: config.kinds.join(', ') }));
    const { project } = contextOf(context);
    const target = join(project, ...SAVED_FOLDER, savedFile(host, kind));
    const where = join(...SAVED_FOLDER, savedFile(host, kind));
    if (action === TEMPLATE_ACTION.show) {
      if (!isFile(target)) throw new SkillError(message('template.absent', { kind }));
      return [readFileSync(target, 'utf8').replace(/\n$/, '')];
    }
    const source = context.options.file;
    if (!source) throw new SkillError(message('template.fileRequired'));
    let text;
    try {
      text = readFileSync(resolve(context.cwd, source), 'utf8');
    } catch (cause) {
      throw new SkillError(message('template.unreadable', { reason: cause.message }));
    }
    if (!text.trim()) throw new SkillError(message('template.empty'));
    if (existsSync(target) && !context.options.force) throw new SkillError(message('template.exists', { path: where }));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    return [message('template.saved', { kind, path: where })];
  }

  return { list, template };
}

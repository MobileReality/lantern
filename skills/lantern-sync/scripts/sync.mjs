#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USAGE = `usage: sync.mjs <command> [options]   (run from the project root, or pass --root <dir>)
  every command accepts [--provider claude|codex]
  status [--base <branch>]
  finish --base <branch> [--model <your exact model id>] [--include-drift]
  pr [<id> --url <url> --title <title>] --base <branch> [--branch <branch>] [--summary <text>] [--reason <path>=<reason>]... [--reason-file <json>]
      [--order <path>]... [--order-file <json array>] [--flow-file <json array>]
      [--describe-file <json object: what, before, after, verified arrays of short texts>]
      [--plan <slug> --item <id>...]
      (without <id>, --url and --title the branch has no pull request: the record is local, in .lantern/local/, never committed; a later pr <id> for the branch adopts it)
  verify --base <branch> [--require-pr] [--require-reason] [--require-order] [--require-flow] [--branch <branch>]
  dismiss <id>...
  tidy --base <branch> [--dry-run]
  local --base <branch> [--head <branch>] [--reason <path>=<reason>]... [--reason-file <json>]
  carry --from <worktree dir> --branch <branch>   (copies the worktree's local record of the branch into this checkout)
every command takes --json`;

const VALUE_FLAGS = new Set(['root', 'base', 'head', 'model', 'url', 'title', 'branch', 'summary', 'reason', 'reason-file', 'order', 'order-file', 'flow-file', 'describe-file', 'provider', 'plan', 'item', 'from']);
const REPEAT_FLAGS = new Set(['reason', 'order', 'item']);
const BOOL_FLAGS = new Set(['json', 'include-drift', 'require-pr', 'require-reason', 'require-order', 'require-flow', 'dry-run']);
const LANTERN_EXCLUDE = ':(exclude).lantern';
const LANTERN_DIR = '.lantern';
const LOCAL_DATA_PREFIX = `${LANTERN_DIR}/.project/`;
const VOCABULARY_TAG = '[vocabulary]';
const RELATIONS_TAG = '[relations]';
const AREAS_TAG = '[areas]';
const AREAS_FILE = '.lantern/areas';
const AREAS_HINT_LINE = 'areas: none yet; a retag would build them';
const MAP_ONLY_SUMMARY = 'Lantern map only: no source file changed';
const NO_RECORD = 'no .lantern/prs/*.pr record (or .lantern/local/*.branch record, when the branch has no pull request) for branch';
const NO_RECORD_NEEDED = 'a .lantern/prs/*.pr record (or .lantern/local/*.branch record, when the branch has no pull request) for branch';

class SyncError extends Error {
    constructor(message, code = 2) {
        super(message);
        this.code = code;
    }
}

function providerFromArgv(argv) {
    const index = argv.indexOf('--provider');
    if (index >= 0) {
        const provider = argv[index + 1];
        if (provider !== 'claude' && provider !== 'codex') throw new SyncError(`--provider needs claude or codex\n${USAGE}`);
        return provider;
    }
    const script = fileURLToPath(import.meta.url);
    if (script.includes(`${path.sep}.agents${path.sep}skills${path.sep}`)) return 'codex';
    return 'claude';
}

function isSetupDir(candidate) {
    return fs.existsSync(path.join(candidate, 'SKILL.md')) && fs.existsSync(path.join(candidate, 'scripts', 'lib.mjs'));
}

function findSetupDir(provider) {
    const scripts = new Set();
    const selfUrl = fileURLToPath(import.meta.url);
    scripts.add(path.resolve(selfUrl));
    if (process.argv[1]) {
        scripts.add(path.resolve(process.argv[1]));
        try {
            scripts.add(fs.realpathSync(process.argv[1]));
        } catch {}
    }
    const tried = [];
    for (const script of scripts) {
        const skillDir = path.dirname(path.dirname(script));
        const candidate = path.join(path.dirname(skillDir), 'lantern-setup');
        if (tried.includes(candidate)) continue;
        tried.push(candidate);
        if (provider === 'codex' ? isSetupDir(candidate) : fs.existsSync(path.join(candidate, 'scripts', 'lib.mjs'))) return candidate;
    }
    if (provider !== 'codex') {
        throw new SyncError(`lantern-setup is not linked next to lantern-sync (looked in ${tried.join(', ')}). Install it with \`pnpm run install-skills -- <project-dir>\` in the Lantern repo (the Lantern app does this too), then retry.`);
    }
    const home = os.homedir();
    const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
    for (const root of [path.join(process.cwd(), '.agents', 'skills'), path.join(home, '.agents', 'skills'), path.join(codexHome, 'skills')]) {
        const candidate = path.join(root, 'lantern-setup');
        if (tried.includes(candidate)) continue;
        tried.push(candidate);
        if (isSetupDir(candidate)) return candidate;
    }
    throw new SyncError(`lantern-setup was not found beside lantern-sync or in a Codex skill root (looked in ${tried.join(', ')}). Install it with \`pnpm run install-skills -- --provider codex <project-dir>\` in the Lantern repo, then retry.`);
}

const PLAN_PROBE = path.join('scripts', 'plan-format.mjs');
const PLAN_MISSING = 'lantern-plan is not installed beside lantern-sync, so plans cannot be read. Install it with `pnpm run install-skills -- <project-dir>` in the Lantern repo (the Lantern app does this too), then retry.';

let setupDir;
try {
    const provider = providerFromArgv(process.argv.slice(2));
    if (provider === 'codex') process.env.LANTERN_PROVIDER = 'codex';
    setupDir = findSetupDir(provider);
} catch (error) {
    process.stderr.write(`lantern-sync: ${error.message}\n`);
    process.exit(2);
}
const importSetup = (name) => import(pathToFileURL(path.join(setupDir, 'scripts', name)).href);
const L = await importSetup('lib.mjs');
const T = await importSetup('texts.mjs');
const P = await importSetup('prs.mjs');
const F = await importSetup('prflow.mjs');
const D = await importSetup('prdescribe.mjs');
const Shell = await importSetup('shell.mjs');
const PlanRef = await importSetup('plan-ref.mjs');

const { cmp } = Shell;

const planCandidate = Shell.siblingSkill(import.meta.url, 'lantern-plan', PLAN_PROBE);
const planDir = fs.existsSync(path.join(planCandidate, PLAN_PROBE)) ? planCandidate : null;
const importPlan = (name) => import(pathToFileURL(path.join(planDir, 'scripts', name)).href);
const Plan = planDir
    ? { format: await importPlan('plan-format.mjs'), io: await importPlan('plan-io.mjs'), model: await importPlan('plan-model.mjs'), messages: await importPlan('plan-messages.mjs'), run: await importPlan('plan-run.mjs') }
    : null;

function planTools() {
    if (!Plan) throw new SyncError(PLAN_MISSING);
    return Plan;
}

function planSay(section, code, params) {
    const { messages } = planTools();
    return messages.say(messages[section][code], params);
}

function parseArgs(argv) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        const name = arg.slice(2);
        if (BOOL_FLAGS.has(name)) flags[name] = true;
        else if (VALUE_FLAGS.has(name)) {
            const value = argv[++i];
            if (value === undefined || value.startsWith('--')) throw new SyncError(`--${name} needs a value\n${USAGE}`);
            if (REPEAT_FLAGS.has(name)) {
                flags[name] ??= [];
                flags[name].push(value);
            } else flags[name] = value;
        } else throw new SyncError(`unknown option --${name}\n${USAGE}`);
    }
    return { positional, flags };
}

function git(root, args, { allowFail = false, input } = {}) {
    const result = Shell.runGit(root, args, { input });
    if (result.error) throw new SyncError(`cannot run git: ${result.error.message}`);
    if (!result.ok) {
        if (allowFail) return null;
        throw new SyncError(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
}

function resolveBase(root, base) {
    const found = [base, `origin/${base}`]
        .map((ref) => ({ ref, sha: git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true })?.trim() }))
        .filter((candidate) => candidate.sha);
    if (found.length === 0) throw new SyncError(`base "${base}" is not a branch or commit here (tried ${base} and origin/${base}); fetch it first`);
    const [local, remote] = found;
    const remoteIsAhead = remote && local.ref === base && local.sha !== remote.sha && git(root, ['merge-base', '--is-ancestor', local.sha, remote.sha], { allowFail: true }) !== null;
    return remoteIsAhead ? remote : local;
}

function changeSet(root, base) {
    const resolved = resolveBase(root, base);
    const mergeBase = git(root, ['merge-base', resolved.sha, 'HEAD'], { allowFail: true })?.trim();
    if (!mergeBase) throw new SyncError(`${resolved.ref} and HEAD share no history`);
    const out = git(root, ['diff', '--name-status', '-z', '-M', '--relative', `${resolved.sha}...HEAD`, '--', '.', LANTERN_EXCLUDE]);
    const tokens = out.split('\0');
    const added = new Set();
    const modified = new Set();
    const removed = new Set();
    const renamed = [];
    for (let i = 0; i < tokens.length && tokens[i] !== ''; ) {
        const status = tokens[i][0];
        if (status === 'R' || status === 'C') {
            const from = tokens[i + 1];
            const to = tokens[i + 2];
            i += 3;
            added.add(to);
            if (status === 'R') {
                removed.add(from);
                renamed.push({ from, to });
            }
            continue;
        }
        const file = tokens[i + 1];
        i += 2;
        if (status === 'A') added.add(file);
        else if (status === 'D') removed.add(file);
        else modified.add(file);
    }
    const sorted = (set) => [...set].sort(cmp);
    return {
        base: resolved.ref,
        baseSha: resolved.sha,
        mergeBase,
        added: sorted(added),
        modified: sorted(modified),
        removed: sorted(removed),
        renamed: renamed.sort((a, b) => cmp(a.from, b.from)),
    };
}

function prEntries(cs) {
    const encoded = (kind, files) => files.map((f) => ({ kind, path: L.encodePath(f) })).sort((a, b) => cmp(a.path, b.path));
    return [...encoded('+', cs.added), ...encoded('~', cs.modified), ...encoded('-', cs.removed)];
}

function lastSourceCommit(root, fallback = null) {
    const sha = git(root, ['rev-list', '-1', 'HEAD', '--', '.', LANTERN_EXCLUDE]).trim();
    if (sha) return sha;
    if (fallback) return fallback;
    throw new SyncError('no commit touches anything outside .lantern/, so there is no #head to record');
}

function mapChangedSince(root, cs) {
    const out = git(root, ['diff', '--name-only', `${cs.baseSha}...HEAD`, '--', '.lantern', ':(exclude).lantern/prs']);
    return out.split('\n').some((line) => line.trim() !== '');
}

function currentBranch(root) {
    const name = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (name === 'HEAD') throw new SyncError('detached HEAD: pass --branch <name>');
    return name;
}

function mainCheckout(root) {
    const gitDir = git(root, ['rev-parse', '--git-dir'], { allowFail: true })?.trim();
    const commonDir = git(root, ['rev-parse', '--git-common-dir'], { allowFail: true })?.trim();
    if (!gitDir || !commonDir) return null;
    const own = fs.realpathSync(path.resolve(root, gitDir));
    const common = fs.realpathSync(path.resolve(root, commonDir));
    if (own === common || path.basename(common) !== '.git') return null;
    const main = path.dirname(common);
    return fs.existsSync(path.join(main, LANTERN_DIR)) ? main : null;
}

function mirrorRecord(root, rel, text) {
    const main = mainCheckout(root);
    if (!main) return null;
    try {
        fs.mkdirSync(path.join(main, LOCAL_DIR), { recursive: true });
        fs.writeFileSync(path.join(main, LOCAL_DIR, '.gitignore'), '*\n');
        fs.writeFileSync(path.join(main, rel), text);
    } catch {
        return null;
    }
    return main;
}

function tryCurrentBranch(root) {
    const name = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true })?.trim();
    return name && name !== 'HEAD' ? name : null;
}

function untrackedMapFiles(root, baseSha) {
    const candidates = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', LANTERN_DIR])
        .split('\0')
        .filter(Boolean)
        .filter((file) => !file.startsWith(LOCAL_DATA_PREFIX))
        .filter((file) => !/[\r\n]/.test(file) && !file.startsWith('"') && !fs.lstatSync(path.join(root, file)).isSymbolicLink());
    const inBase = new Map();
    for (const entry of git(root, ['ls-tree', '-r', '-z', baseSha, '--', LANTERN_DIR], { allowFail: true })?.split('\0').filter(Boolean) ?? []) {
        const tab = entry.indexOf('\t');
        inBase.set(entry.slice(tab + 1), entry.slice(0, tab).split(' ')[2]);
    }
    const comparable = candidates.filter((file) => inBase.has(file));
    const hashes = comparable.length ? git(root, ['hash-object', '--stdin-paths'], { input: `${comparable.join('\n')}\n` }).trim().split('\n') : [];
    const same = new Set(comparable.filter((file, index) => inBase.get(file) === hashes[index]));
    return { duplicate: candidates.filter((file) => same.has(file)).sort(cmp), other: candidates.filter((file) => !same.has(file)).sort(cmp) };
}

function readState(root) {
    const enumerated = new Map(L.enumerate(root).map((f) => [f.path, f]));
    const { records } = L.loadMap(root);
    const byPath = new Map(records.map((r) => [r.path, r]));
    const hashOf = (rel) => {
        try {
            return L.hashFile(root, rel);
        } catch {
            return null;
        }
    };
    const changed = [];
    const gone = [];
    for (const record of records) {
        const exists = fs.existsSync(path.join(root, record.path));
        if (!exists) {
            if (record.marker === '.' || record.marker === '~') gone.push(record.path);
            continue;
        }
        if (record.marker === '.' && hashOf(record.path) !== record.hash) changed.push(record.path);
    }
    const unmapped = [...enumerated.keys()].filter((p) => !byPath.has(p));
    return {
        enumerated,
        records,
        byPath,
        hashOf,
        changed: changed.sort(cmp),
        unmapped: unmapped.sort(cmp),
        gone: gone.sort(cmp),
    };
}

function requireMap(root) {
    if (!fs.existsSync(path.join(root, L.MAP_DIR))) {
        throw new SyncError(`no ${L.MAP_DIR} in ${root}: this project has no Lantern map yet (that is lantern-setup, not lantern-sync)`);
    }
}

function pruneEmptyDirs(root, file) {
    const stops = new Set([path.join(root, L.MAP_DIR), ...T.listLangs(root).map((code) => path.join(root, T.LANG_DIR, code))]);
    let dir = path.dirname(path.join(root, file));
    while (!stops.has(dir) && dir.startsWith(root) && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
    }
}

function dropTextKeys(root, mapFile, removedPaths) {
    let dropped = 0;
    for (const code of T.listLangs(root)) {
        const rel = T.langFileFor(mapFile, code);
        const abs = path.join(root, rel);
        if (!fs.existsSync(abs)) continue;
        const raw = fs.readFileSync(abs, 'utf8');
        let json;
        try {
            json = JSON.parse(raw);
        } catch {
            continue;
        }
        if (!json?.text || typeof json.text !== 'object') continue;
        let touched = false;
        for (const removedPath of removedPaths) {
            const name = T.keyName(removedPath);
            for (const key of Object.keys(json.text)) {
                if (key === name || key.startsWith(`${name} `)) {
                    delete json.text[key];
                    dropped++;
                    touched = true;
                }
            }
        }
        if (!touched) continue;
        const indent = /^\{\r?\n([ \t]+)"/.exec(raw)?.[1] ?? ' ';
        fs.writeFileSync(abs, `${JSON.stringify(json, null, indent)}${raw.endsWith('\n') ? '\n' : ''}`);
    }
    return dropped;
}

function removeRecords(root, paths) {
    const wanted = new Set(paths);
    const byMapFile = new Map();
    for (const record of L.loadMap(root).records) {
        if (!wanted.has(record.path)) continue;
        if (!byMapFile.has(record.file)) byMapFile.set(record.file, new Set());
        byMapFile.get(record.file).add(record.path);
    }
    const result = { removed: [], deletedMapFiles: [], textKeysDropped: 0 };
    for (const [mapFile, drop] of byMapFile) {
        const abs = path.join(root, mapFile);
        const kept = [];
        let sawHeader = false;
        let skipping = false;
        for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
            if (!sawHeader) {
                if (line.trim() !== '') sawHeader = true;
            } else if (line !== '' && !/^\s/.test(line) && !line.startsWith('#')) {
                const recordPath = L.decodePath(line.split(/\s+/)[0]);
                skipping = drop.has(recordPath);
                if (skipping) result.removed.push(recordPath);
            }
            if (!skipping) kept.push(line);
        }
        const text = `${kept.join('\n').replace(/\n+$/, '')}\n`;
        if (L.parseMapFile(text, mapFile).records.length === 0) {
            fs.unlinkSync(abs);
            pruneEmptyDirs(root, mapFile);
            for (const code of T.listLangs(root)) {
                const langRel = T.langFileFor(mapFile, code);
                if (!fs.existsSync(path.join(root, langRel))) continue;
                fs.unlinkSync(path.join(root, langRel));
                pruneEmptyDirs(root, langRel);
            }
            result.deletedMapFiles.push(mapFile);
        } else {
            fs.writeFileSync(abs, text);
            result.textKeysDropped += dropTextKeys(root, mapFile, drop);
        }
    }
    result.removed.sort(cmp);
    return result;
}

function sectionCitations(root, touched) {
    const dir = path.join(root, '.lantern', 'sections');
    if (!fs.existsSync(dir)) return [];
    const found = [];
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.section')).sort()) {
        const cited = new Set();
        for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/)) {
            const at = line.indexOf(' @ ');
            if (at === -1 || line.startsWith('#')) continue;
            for (const token of line.slice(at + 3).trim().split(/\s+/)) {
                const cite = L.decodePath(token.split('#')[0]);
                if (touched.has(cite)) cited.add(cite);
            }
        }
        for (const cite of [...cited].sort(cmp)) found.push({ section: name.replace(/\.section$/, ''), path: cite });
    }
    return found;
}

function buildWorkList(root, state, cs, options) {
    const reasons = new Map();
    const add = (file, reason) => {
        if (!reasons.has(file)) reasons.set(file, []);
        if (!reasons.get(file).includes(reason)) reasons.get(file).push(reason);
    };
    const addedSet = new Set(cs.added);
    for (const file of [...cs.added, ...cs.modified]) {
        if (!state.enumerated.has(file)) continue;
        const record = state.byPath.get(file);
        if (!record) add(file, addedSet.has(file) ? 'added, no record' : 'modified, no record');
        else if (record.marker !== '.') add(file, `record still carries marker ${record.marker}`);
        else if (state.hashOf(file) !== record.hash) add(file, 'modified, record stale');
    }
    const touched = new Set([...cs.added, ...cs.modified, ...cs.removed, ...options.gone]);
    const removedTargets = new Set([...cs.removed, ...options.gone]);
    for (const record of state.records) {
        if (!fs.existsSync(path.join(root, record.path))) continue;
        for (const relation of record.relations) {
            if (relation.path === null || !touched.has(relation.path)) continue;
            if (removedTargets.has(relation.path) && !fs.existsSync(path.join(root, relation.path))) {
                add(record.path, `relation ${relation.arrow} ${relation.path} points at a removed or renamed file`);
            } else if (relation.symbol) {
                let content = null;
                try {
                    content = fs.readFileSync(path.join(root, relation.path), 'utf8');
                } catch {}
                if (content !== null && !L.containsSymbol(content, relation.symbol)) {
                    add(record.path, `relation ${relation.arrow} ${relation.path}#${relation.symbol}: symbol no longer in the target`);
                }
            }
        }
        for (const target of record.seeAlso ?? []) {
            if (removedTargets.has(target) && !fs.existsSync(path.join(root, target))) add(record.path, `#see-also ${target} points at a removed or renamed file`);
        }
    }
    if (options.includeDrift) {
        for (const file of state.changed) add(file, 'stale, outside this change');
        for (const file of state.unmapped) add(file, 'unmapped, outside this change');
    }
    const work = [...reasons.entries()]
        .map(([file, why]) => ({ path: file, hash: state.hashOf(file), mapFile: L.mapFileFor(file), reasons: why }))
        .sort((a, b) => cmp(a.mapFile, b.mapFile) || cmp(a.path, b.path));
    return { work };
}

function dirtySource(root) {
    const out = git(root, ['status', '--porcelain', '-z', '--', '.', LANTERN_EXCLUDE]);
    return out.split('\0').filter(Boolean).map((entry) => entry.slice(3));
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function singleLine(name, value) {
    const text = (value ?? '').trim();
    if (!text) throw new SyncError(`--${name} is required\n${USAGE}`);
    if (/[\r\n]/.test(text)) throw new SyncError(`--${name} must be one line`);
    return text;
}

const EXEMPT_NAMES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'npm-shrinkwrap.json', 'Cargo.lock', 'poetry.lock', 'Gemfile.lock', 'composer.lock', 'go.sum', 'Pipfile.lock']);
const EXEMPT_PATTERN = /\.(png|jpe?g|gif|webp|ico|icns|svg|woff2?|ttf|otf|eot|snap|map)$|\.min\.(js|css)$|\.generated\.[^/]+$|(^|\/)__generated__\//i;
const EXEMPT_REASON = 'Lockfile, asset or generated file; nothing to reason about beyond its source.';

function isExempt(file) {
    return EXEMPT_NAMES.has(file.split('/').pop()) || EXEMPT_PATTERN.test(file);
}

function unexplainedMessage(label, files, total) {
    const shown = files.slice(0, 5).join(', ') + (files.length > 5 ? `, +${files.length - 5} more` : '');
    return `${label}: ${files.length} of ${total} changed file(s) have no reason (${shown}); re-run sync.mjs pr with --reason <path>=<reason>`;
}

function normalizeReason(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function collectReasons(flags, known, existing) {
    const reasons = new Map([...existing].filter(([file]) => known.has(file)));
    const apply = (file, text, source) => {
        if (!known.has(file)) throw new SyncError(`${source} names ${file}, which is not a file this pull request changes (outside .lantern/, against the base)`);
        const reason = normalizeReason(text);
        if (reason === '') {
            reasons.delete(file);
            return;
        }
        const problem = P.reasonProblem(reason);
        if (problem) throw new SyncError(`${source} for ${file}: ${problem}`);
        reasons.set(file, reason);
    };
    if (flags['reason-file'] !== undefined) {
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(path.resolve(flags['reason-file']), 'utf8'));
        } catch (error) {
            throw new SyncError(`--reason-file ${flags['reason-file']}: ${error.message}`);
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyncError('--reason-file must hold a JSON object {"<path>": "<reason>"}');
        for (const [file, text] of Object.entries(parsed)) {
            if (typeof text !== 'string') throw new SyncError(`--reason-file: the reason for ${file} must be a string`);
            apply(file, text, '--reason-file');
        }
    }
    for (const arg of flags.reason ?? []) {
        const file = [...known].filter((candidate) => arg.startsWith(`${candidate}=`)).sort((a, b) => b.length - a.length)[0];
        if (file === undefined) throw new SyncError(`--reason "${arg}" must be <path>=<reason> with a path this pull request changes`);
        apply(file, arg.slice(file.length + 1), '--reason');
    }
    return reasons;
}

function collectOrder(flags, known, existing) {
    const asked = flags['order-file'] !== undefined || (flags.order ?? []).length > 0;
    if (!asked) return existing.filter((file) => known.has(file));
    const order = [];
    const add = (file, source) => {
        if (!known.has(file)) throw new SyncError(`${source} names ${file}, which is not a file this pull request changes (outside .lantern/, against the base)`);
        if (order.includes(file)) throw new SyncError(`${source} names ${file} twice`);
        order.push(file);
    };
    if (flags['order-file'] !== undefined) {
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(path.resolve(flags['order-file']), 'utf8'));
        } catch (error) {
            throw new SyncError(`--order-file ${flags['order-file']}: ${error.message}`);
        }
        if (!Array.isArray(parsed)) throw new SyncError('--order-file must hold a JSON array of paths, first = review first');
        for (const file of parsed) {
            if (typeof file !== 'string') throw new SyncError('--order-file: every entry must be a path string');
            add(file, '--order-file');
        }
    }
    for (const file of flags.order ?? []) add(file, '--order');
    return order;
}

function collectFlow(flags, existing, listed) {
    if (flags['flow-file'] === undefined) return existing;
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(path.resolve(flags['flow-file']), 'utf8'));
    } catch (error) {
        throw new SyncError(`--flow-file ${flags['flow-file']}: ${error.message}`);
    }
    const flow = F.flowFromJson(parsed, listed);
    if (flow.errors.length) throw new SyncError(`--flow-file ${flags['flow-file']} is not a valid flow:\n  ${flow.errors.join('\n  ')}`);
    return flow.stories;
}

function collectDescription(flags, existing) {
    if (flags['describe-file'] === undefined) return existing;
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(path.resolve(flags['describe-file']), 'utf8'));
    } catch (error) {
        throw new SyncError(`--describe-file ${flags['describe-file']}: ${error.message}`);
    }
    const described = D.describeFromJson(parsed);
    if (described.errors.length) throw new SyncError(`--describe-file ${flags['describe-file']} is not a valid description:\n  ${described.errors.join('\n  ')}`);
    return described.description;
}

function readPlan(root, slug) {
    const { io } = planTools();
    const rel = io.planRel(slug);
    const abs = path.join(root, rel);
    return fs.existsSync(abs) ? { rel, missing: false, ...io.readPlanFile(abs, rel) } : { rel, missing: true, errors: [] };
}

const planItemIds = (plan) => planTools().model.allItems(plan).map((item) => item.id);

const PLAN_REF_RULES = [
    [(c) => c.found === null, 'SYNC_PLAN_BAD_SLUG', 'USAGE'],
    [(c) => c.found.missing, 'SYNC_PLAN_NOT_FOUND', 'FAILED'],
    [(c) => c.found.errors.length > 0, 'SYNC_PLAN_NO_PARSE', 'FAILED'],
    [(c) => c.unknown.length > 0, 'SYNC_PLAN_UNKNOWN_ITEM', 'FAILED'],
];

function collectPlans(root, flags, existing) {
    const slug = flags.plan;
    const items = [...new Set(flags.item ?? [])];
    if (slug === undefined && items.length === 0) return existing;
    if (slug === undefined) throw new SyncError('--item needs --plan <slug>');
    if (items.length === 0) throw new SyncError('--plan needs at least one --item <id>');
    const { format, messages } = planTools();
    const found = slug !== undefined && format.SLUG.test(slug) ? readPlan(root, slug) : null;
    const known = found?.plan && found.errors.length === 0 ? planItemIds(found.plan) : [];
    const unknown = items.filter((item) => !known.includes(item));
    const broken = PLAN_REF_RULES.find(([applies]) => applies({ slug, items, found, unknown }));
    if (broken) throw new SyncError(planSay('ERROR', broken[1], { slug, dir: format.PLAN_DIR, rel: found?.rel, errors: found?.errors.join('\n  '), items: unknown.join(', '), known: known.join(', ') }), messages.EXIT[broken[2]]);
    return items.map((item) => ({ slug, item }));
}

function withListedFiles(steps, listed) {
    return steps.map(({ files, ...step }) => {
        const kept = (files ?? []).filter((file) => listed.has(file));
        return kept.length ? { ...step, files: kept } : step;
    });
}

function flowHasNoFiles(flow) {
    return flow.length > 0 && !flow.some((story) => [...story.steps, ...story.below].some((step) => step.files?.length));
}

// Older maps recorded their writer in `#model` lines and `"model"` fields. Readers ignore them;
// migrate-model.mjs strips them from the whole map in one commit, so a map half with and half
// without them means someone stripped by hand.
const MAP_PROVENANCE = /^#model(\s|$)/m;
const PROVENANCE_HINT = /#model|"model"\s*:/;
const MIGRATE_HINT = 'run lantern-setup/scripts/migrate-model.mjs . for the whole map in one commit';

function mapAndSectionFiles(root) {
    const sections = path.join(root, LANTERN_DIR, 'sections');
    const sectionFiles = fs.existsSync(sections) ? fs.readdirSync(sections).filter((f) => f.endsWith('.section')).map((f) => `${LANTERN_DIR}/sections/${f}`) : [];
    return [...L.listMapFiles(root), ...sectionFiles];
}

function carriesProvenance(file, text) {
    if (!file.endsWith('.json')) return MAP_PROVENANCE.test(text);
    try {
        const parsed = JSON.parse(text);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.hasOwn(parsed, 'model');
    } catch {
        return false;
    }
}

function isMapData(file) {
    return file.endsWith('.json') || file.endsWith('.section') || file.startsWith(`${L.MAP_DIR}/`);
}

function partlyMigrated(root) {
    const files = mapAndSectionFiles(root);
    const marked = files.filter((file) => carriesProvenance(file, fs.readFileSync(path.join(root, file), 'utf8'))).length;
    return marked > 0 && marked < files.length ? `map partly migrated: ${marked} of ${files.length} map/section file(s) still carry #model; ${MIGRATE_HINT}` : null;
}

function addedProvenance(root, mergeBase) {
    const diff = git(root, ['-c', 'core.quotePath=false', 'diff', '-U0', '--diff-filter=AM', `${mergeBase}...HEAD`, '--', LANTERN_DIR]);
    const candidates = new Set();
    let current = null;
    for (const line of diff.split('\n')) {
        const header = /^\+\+\+ "?b\/(.+?)"?\t?$/.exec(line);
        if (header) current = header[1];
        else if (current && line.startsWith('+') && PROVENANCE_HINT.test(line)) candidates.add(current);
    }
    return [...candidates].filter((file) => {
        if (!isMapData(file)) return false;
        const now = git(root, ['show', `HEAD:${file}`], { allowFail: true }) ?? '';
        const before = git(root, ['show', `${mergeBase}:${file}`], { allowFail: true }) ?? '';
        return carriesProvenance(file, now) && !carriesProvenance(file, before);
    });
}

function cmdStatus(root, flags) {
    const report = { root, map: fs.existsSync(path.join(root, L.MAP_DIR)) };
    if (!report.map) {
        report.note = `no ${L.MAP_DIR}: nothing to keep true (lantern-setup builds the map)`;
        return { report, human: [`lantern-sync status: ${report.note}`] };
    }
    const state = readState(root);
    report.records = state.records.length;
    report.drift = { changed: state.changed, unmapped: state.unmapped, gone: state.gone };
    const human = [`lantern-sync status: ${state.records.length} records; drift: ${state.changed.length} changed, ${state.unmapped.length} new/unmapped, ${state.gone.length} gone`];
    report.partlyMigrated = partlyMigrated(root);
    if (report.partlyMigrated) human.push(`warning: ${report.partlyMigrated}`);
    report.areasHint = !fs.existsSync(path.join(root, AREAS_FILE)) && L.meetsAreasThresholds(state.records);
    if (report.areasHint) human.push(AREAS_HINT_LINE);
    if (flags.base) {
        const resolved = resolveBase(root, flags.base);
        const inBase = git(root, ['ls-tree', '--name-only', resolved.sha, '--', `${L.MAP_DIR}/`], { allowFail: true })?.trim();
        report.untracked = !inBase;
        if (report.untracked) human.push(`map: untracked on ${resolved.ref}`);
        const stray = untrackedMapFiles(root, resolved.sha);
        report.untrackedDuplicates = stray.duplicate;
        if (stray.duplicate.length) human.push(`stray: ${stray.duplicate.length} untracked ${LANTERN_DIR}/ file(s) identical to ${resolved.ref}; run sync.mjs tidy --base ${flags.base}`);
    }
    for (const [label, list] of [['changed', state.changed], ['new', state.unmapped], ['gone', state.gone]]) {
        for (const file of list) human.push(`  ${label.padEnd(7)} ${file}`);
    }
    if (flags.base) {
        report.changeSet = changeSet(root, flags.base);
        const cs = report.changeSet;
        human.push(`change set ${cs.base}...HEAD (merge-base ${cs.mergeBase.slice(0, 9)}): +${cs.added.length} ~${cs.modified.length} -${cs.removed.length}`);
        for (const [mark, list] of [['+', cs.added], ['~', cs.modified], ['-', cs.removed]]) {
            for (const file of list) human.push(`  ${mark} ${file}`);
        }
        for (const { from, to } of cs.renamed) human.push(`  renamed ${from} -> ${to}`);
    }
    const prs = P.listPrs(root);
    report.prs = prs.map((pr) => ({ id: pr.id, branch: pr.branch, base: pr.base, head: pr.head, files: pr.files.length }));
    report.dismissed = prs.dismissed ? prs.dismissed.ids : [];
    human.push(`dismissed: ${report.dismissed.length}`);
    if (prs.dismissed?.errors.length) human.push(...prs.dismissed.errors.map((e) => `  ${e}`));
    if (prs.length) human.push(`pr records: ${prs.map((pr) => `#${pr.id ?? '?'} (${pr.branch ?? '?'})`).join(', ')}`);
    const branchRecords = P.listBranchRecords(root);
    report.branchRecords = branchRecords.map((record) => ({ branch: record.branch, base: record.base, head: record.head, files: record.files.length }));
    if (branchRecords.length) human.push(`branch records (no pull request): ${branchRecords.map((record) => record.branch ?? '?').join(', ')}`);
    return { report, human };
}

function cmdFinish(root, flags) {
    requireMap(root);
    if (!flags.base) throw new SyncError(`finish needs --base <branch>\n${USAGE}`);
    if (flags.model && !L.modelAllowed(flags.model)) {
        if (L.codexAllowed(flags.model)) {
            throw new SyncError(`model "${flags.model}" is not allowed to write the map on this route (${L.modelFloorLabel()}); it maps only on the Codex route. Stop and hand the re-map to a model that passes.`);
        }
        throw new SyncError(`model "${flags.model}" is not an accepted model (${L.isCodexRoute() ? L.codexFloorLabel() : L.modelFloorLabel()}): do not map on it. Stop and hand the re-map to a model that passes.`);
    }
    const advisory = flags.model ? L.modelAdvisory(flags.model) : null;
    const cs = changeSet(root, flags.base);
    const before = readState(root);
    const removal = removeRecords(root, before.gone);
    const state = readState(root);
    const { work } = buildWorkList(root, state, cs, { includeDrift: Boolean(flags['include-drift']), gone: before.gone });
    const touched = new Set([...cs.added, ...cs.modified, ...cs.removed]);
    const sections = sectionCitations(root, touched);
    const outside = { changed: state.changed.filter((f) => !work.some((w) => w.path === f)), unmapped: state.unmapped.filter((f) => !work.some((w) => w.path === f)) };
    const uncommitted = dirtySource(root);
    const report = { changeSet: cs, removal, workList: work, sectionsToRecheck: sections, driftOutsideChange: outside, uncommittedSource: uncommitted };
    const human = [`lantern-sync finish (base ${cs.base}, merge-base ${cs.mergeBase.slice(0, 9)}): +${cs.added.length} ~${cs.modified.length} -${cs.removed.length}`];
    if (uncommitted.length) human.push(`WARNING: ${uncommitted.length} uncommitted change(s) outside .lantern/ (${uncommitted.slice(0, 5).join(', ')}${uncommitted.length > 5 ? ', ...' : ''}); the change set is what is committed since ${cs.base}, so commit your code first`);
    if (removal.removed.length) {
        human.push(`removed ${removal.removed.length} record(s) of deleted files (${removal.textKeysDropped} text key(s) dropped):`);
        for (const file of removal.removed) human.push(`  ${file}`);
        for (const file of removal.deletedMapFiles) human.push(`  deleted empty map file ${file}`);
    } else human.push('no records of deleted files to remove');
    if (work.length) {
        human.push(`WORK LIST: ${work.length} file(s). Re-map exactly these (lantern-setup Procedure step 3), then run validate.mjs . --settled and this command again:`);
        human.push('# path hash map-file: why');
        for (const item of work) human.push(`${L.encodePath(item.path)} ${item.hash ?? '-'} ${item.mapFile}: ${item.reasons.join('; ')}`);
    } else human.push('WORK LIST EMPTY');
    if (advisory) human.push(`note: model ${flags.model} is ${advisory}; the re-map goes ahead.`);
    if (!flags.model) human.push(`note: no --model given; only a model that passes model.mjs check may re-map these. Re-run with --model <your exact id> to have it checked.`);
    for (const cite of sections) human.push(`re-check section ${cite.section}: it cites ${cite.path}`);
    if (outside.changed.length || outside.unmapped.length) {
        human.push(`drift outside this change (not listed; pass --include-drift to heal it in this PR): ${outside.changed.length} stale, ${outside.unmapped.length} unmapped`);
    }
    return { report, human };
}

function cmdPr(root, positional, flags) {
    if (!fs.existsSync(path.join(root, '.lantern'))) throw new SyncError(`no .lantern/ in ${root}`);
    const id = positional[0];
    const noPr = id === undefined;
    if (noPr && (flags.url !== undefined || flags.title !== undefined)) throw new SyncError(`a record for a branch with no pull request takes no <id>, --url or --title; pass all three for a pull request\n${USAGE}`);
    if (!noPr && !/^\d+$/.test(id)) throw new SyncError(`pr needs a numeric <id>\n${USAGE}`);
    if (!noPr && P.readDismissed(root)?.ids.some((dismissedId) => BigInt(dismissedId) === BigInt(id))) throw new SyncError(`pull request #${id} is dismissed (${P.PR_DIR}/${P.DISMISSED_FILE}); refusing to write a record for it`, 1);
    const title = noPr ? null : singleLine('title', flags.title);
    const url = noPr ? null : singleLine('url', flags.url);
    const base = singleLine('base', flags.base);
    const branch = flags.branch ? singleLine('branch', flags.branch) : currentBranch(root);
    const summaryFlag = flags.summary === undefined ? null : singleLine('summary', flags.summary);
    const cs = changeSet(root, base);
    const entries = prEntries(cs);
    const mapOnly = entries.length === 0;
    if (mapOnly && !mapChangedSince(root, cs)) throw new SyncError(`nothing changed between ${cs.base} and HEAD, .lantern/ included; there is no ${noPr ? 'branch' : 'PR'} to record`, 1);
    const summary = summaryFlag ?? (mapOnly ? MAP_ONLY_SUMMARY : null);
    const head = lastSourceCommit(root, mapOnly ? cs.mergeBase : null);

    const rel = noPr ? `${P.BRANCH_DIR}/${P.branchFileName(branch)}` : `${P.PR_DIR}/${id}.pr`;
    const parseRecord = noPr ? P.parseBranchRecord : P.parsePr;
    const abs = path.join(root, rel);
    const localRel = `${P.BRANCH_DIR}/${P.branchFileName(branch)}`;
    const localAbs = path.join(root, localRel);
    const adopted = !noPr && !fs.existsSync(abs) && fs.existsSync(localAbs) ? P.parseBranchRecord(fs.readFileSync(localAbs, 'utf8'), localRel) : null;
    if (adopted?.errors.length) throw new SyncError(`${localRel} is malformed, fix or delete it first:\n  ${adopted.errors.join('\n  ')}`, 1);
    let opened = today();
    const kept = new Map();
    let keptOrder = [];
    let keptFlow = [];
    let keptDescription = {};
    let keptPlans = [];
    const existing = adopted ?? (fs.existsSync(abs) ? parseRecord(fs.readFileSync(abs, 'utf8'), rel) : null);
    if (existing) {
        if (existing.branch !== branch) throw new SyncError(`${rel} already records branch "${existing.branch ?? '?'}", not "${branch}"; refusing to overwrite another pull request`, 1);
        opened = existing.opened ?? opened;
        for (const file of existing.files) if (file.reason) kept.set(file.path, file.reason);
        keptOrder = existing.order;
        keptFlow = existing.flow;
        keptDescription = existing.description;
        keptPlans = existing.plans;
    }
    const description = collectDescription(flags, keptDescription);
    const plans = collectPlans(root, flags, keptPlans);
    const known = new Set([...cs.added, ...cs.modified, ...cs.removed]);
    const reasons = collectReasons(flags, known, kept);
    const order = collectOrder(flags, known, keptOrder);
    const listed = new Set(entries.map((entry) => L.decodePath(entry.path)));
    const flow = collectFlow(flags, keptFlow.map((story) => ({ ...story, steps: withListedFiles(story.steps, listed), below: withListedFiles(story.below, listed) })), listed);
    for (const other of P.listPrs(root)) {
        if (other.branch === branch && other.id !== id) throw new SyncError(`${other.file} already records branch "${branch}" as pull request #${other.id}; refusing to add a second record for it`, 1);
    }

    for (const entry of entries) {
        const file = L.decodePath(entry.path);
        if (!reasons.has(file) && isExempt(file)) reasons.set(file, EXEMPT_REASON);
    }
    const unexplainedFiles = entries.map((entry) => L.decodePath(entry.path)).filter((file) => !reasons.has(file));
    if (unexplainedFiles.length) {
        throw new SyncError(`refusing to write ${rel}: ${unexplainedFiles.length} of ${entries.length} changed file(s) have no reason:\n  ${unexplainedFiles.join('\n  ')}\nGive each one with --reason <path>=<reason> or --reason-file (one sentence of why, not what); lockfiles, assets and generated files get a default.`, 1);
    }
    const lines = noPr
        ? [P.BRANCH_HEADER, `#branch ${branch}`, `#base ${base}`, `#opened ${opened}`, `#head ${head}`]
        : [P.PR_HEADER, `# ${id}`, `#title ${title}`, `#url ${url}`, `#branch ${branch}`, `#base ${base}`, `#opened ${opened}`, `#head ${head}`];
    if (summary) lines.push(`#summary ${summary}`);
    lines.push(...D.describeRecordLines(description));
    for (const ref of plans) lines.push(`#plan ${ref.slug} ${ref.item}`);
    for (const entry of entries) lines.push(`${entry.kind} ${entry.path}`);
    for (const file of order) lines.push(`#order ${L.encodePath(file)}`);
    for (const entry of entries) {
        const reason = reasons.get(L.decodePath(entry.path));
        if (reason) lines.push(`#reason ${entry.path} ${reason}`);
    }
    lines.push(...F.flowRecordLines(flow));
    const text = `${lines.join('\n')}\n`;
    const parsed = parseRecord(text, rel);
    const problems = [...parsed.errors, ...parsed.warnings];
    if (problems.length) throw new SyncError(`generated record does not validate:\n  ${problems.join('\n  ')}`, 1);

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (noPr) fs.writeFileSync(path.join(root, LOCAL_DIR, '.gitignore'), '*\n');
    fs.writeFileSync(abs, text);
    if (adopted) {
        fs.unlinkSync(localAbs);
        const main = mainCheckout(root);
        if (main && fs.existsSync(path.join(main, localRel))) fs.unlinkSync(path.join(main, localRel));
    }
    const mirrored = noPr ? mirrorRecord(root, rel, text) : null;
    const flowFiles = flow.reduce((sum, story) => sum + [...story.steps, ...story.below].filter((step) => step.files?.length).length, 0);
    const report = { file: rel, id: id ?? null, branch, base, head, added: cs.added.length, modified: cs.modified.length, removed: cs.removed.length, reasons: reasons.size, ordered: order.length, flow: flow.length, flowSteps: flowFiles, described: D.describeRecordLines(description).length, plans };
    const planned = plans.length ? `, ticks ${plans.map((ref) => `${ref.slug} ${ref.item}`).join(', ')}` : '';
    report.adopted = adopted ? localRel : null;
    report.mirrored = mirrored;
    const next = noPr
        ? `next: ${rel} is never committed (its folder is ignored); ${mirrored ? `a copy is already in the project at ${mirrored}, so the Lantern app shows it now` : 'it is not in the project yet: the orchestrator copies it with sync.mjs carry before the worktree goes'}.`
        : `next: git add ${rel}; commit "chore: record pull request #${id} in the Lantern map"; plain git push (never force).`;
    const human = [`wrote ${rel}: +${cs.added.length} ~${cs.modified.length} -${cs.removed.length}, ${reasons.size}/${entries.length} with a reason, ${order.length}/${entries.length} with a review position, ${flow.length} flow stories (${flowFiles} steps with files), ${report.described} description lines${planned}, #head ${head.slice(0, 9)}`];
    if (adopted) human.push(`adopted the local record ${localRel} (reasons, order, flow, description and plan ticks kept) and removed it`);
    human.push(next);
    return { report, human };
}

const LOCAL_DIR = '.lantern/local';
const WORKTREE = '@';

function localVersion(root, before, headSha, file) {
    if (headSha) return `${before}:${headSha}`;
    try {
        const stat = fs.lstatSync(path.join(root, file));
        return `${before}:${stat.size}:${stat.mtimeMs}`;
    } catch {
        return `${before}:gone`;
    }
}

function localChangeSet(root, base, head) {
    const resolved = resolveBase(root, base);
    const headSha = head ? resolveBase(root, head).sha : git(root, ['rev-parse', '--verify', 'HEAD']).trim();
    const before = git(root, ['merge-base', resolved.sha, headSha], { allowFail: true })?.trim() || resolved.sha;
    const range = head ? [before, headSha] : [before];
    const files = new Set(git(root, ['diff', '--name-only', '-z', '--no-renames', ...range, '--', '.', LANTERN_EXCLUDE]).split('\0').filter(Boolean));
    if (!head) for (const file of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) if (file && !file.startsWith(`${LANTERN_DIR}/`)) files.add(file);
    const lastSource = head ? git(root, ['rev-list', '-1', headSha, '--', '.', LANTERN_EXCLUDE]).trim() : '';
    return { before, headSha: head ? lastSource || headSha : null, files };
}

function cmdLocal(root, flags) {
    if (!fs.existsSync(path.join(root, LANTERN_DIR))) throw new SyncError(`no .lantern/ in ${root}`);
    const base = singleLine('base', flags.base);
    const head = flags.head === undefined ? null : singleLine('head', flags.head);
    const cs = localChangeSet(root, base, head);
    if (cs.files.size === 0) throw new SyncError(`nothing differs between ${base} and ${head ?? 'the working tree'}; there is nothing to give a reason for`, 1);
    const reasons = collectReasons(flags, cs.files, new Map());
    for (const file of cs.files) if (!reasons.has(file) && isExempt(file)) reasons.set(file, EXEMPT_REASON);
    if (reasons.size === 0) throw new SyncError('no reason given: pass --reason <path>=<reason> or --reason-file {"<path>": "<reason>"}', 1);
    const safe = (name) => name.replace(/[^\w.-]+/g, '_');
    const rel = `${LOCAL_DIR}/${safe(base)}__${head ? safe(head) : 'worktree'}.reason`;
    const lines = ['lantern-local 1', `#base ${base}`, `#head ${head ?? WORKTREE}`, `#at ${today()}`];
    for (const file of [...cs.files].sort(cmp)) {
        const reason = reasons.get(file);
        if (reason) lines.push(`#reason ${L.encodePath(file)} ${localVersion(root, cs.before, cs.headSha, file)} ${reason}`);
    }
    fs.mkdirSync(path.join(root, LOCAL_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, LOCAL_DIR, '.gitignore'), '*\n');
    fs.writeFileSync(path.join(root, rel), `${lines.join('\n')}\n`);
    const missing = [...cs.files].filter((file) => !reasons.has(file));
    const report = { file: rel, base, head: head ?? WORKTREE, files: cs.files.size, reasons: reasons.size, missing };
    const human = [`wrote ${rel}: ${reasons.size}/${cs.files.size} changed files with a reason${missing.length ? ` (no reason yet: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? `, +${missing.length - 5} more` : ''})` : ''}`, `next: lantern --compare ${base}${head ? `..${head}` : ''}   (opens the comparison in the Lantern app)`];
    return { report, human };
}

function cmdCarry(root, flags) {
    if (!fs.existsSync(path.join(root, LANTERN_DIR))) throw new SyncError(`no .lantern/ in ${root}`);
    const from = path.resolve(singleLine('from', flags.from));
    const branch = singleLine('branch', flags.branch);
    if (from === root) throw new SyncError('--from is the project itself; carry copies a worktree record into another checkout');
    const rel = `${P.BRANCH_DIR}/${P.branchFileName(branch)}`;
    const source = path.join(from, rel);
    if (!fs.existsSync(source)) throw new SyncError(`${source} does not exist: write the record in that worktree with sync.mjs pr (no <id>) first`, 1);
    const text = fs.readFileSync(source, 'utf8');
    const record = P.parseBranchRecord(text, rel);
    if (record.errors.length) throw new SyncError(`${source} is malformed:\n  ${record.errors.join('\n  ')}`, 1);
    if (record.branch !== branch) throw new SyncError(`${source} records branch "${record.branch}", not "${branch}"`, 1);
    fs.mkdirSync(path.join(root, LOCAL_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, LOCAL_DIR, '.gitignore'), '*\n');
    fs.writeFileSync(path.join(root, rel), text);
    return { report: { file: rel, from, branch, files: record.files.length }, human: [`copied ${rel} for branch ${branch} (${record.files.length} files) from ${from}; it stays out of git, the Lantern app and plan.mjs status read it here`] };
}

function cmdDismiss(root, ids) {
    if (!fs.existsSync(path.join(root, '.lantern'))) throw new SyncError(`no .lantern/ in ${root}`);
    if (!ids.length) throw new SyncError(`dismiss needs at least one <id>\n${USAGE}`);
    for (const id of ids) if (!/^\d+$/.test(id)) throw new SyncError(`invalid pull request id "${id}": ids are digits only\n${USAGE}`);
    const normalized = ids.map((id) => String(BigInt(id)));
    const current = P.readDismissed(root);
    if (current?.errors.length) throw new SyncError(`${current.file} is malformed, fix it first:\n  ${current.errors.join('\n  ')}`);
    const known = new Set(current?.ids ?? []);
    const deleted = [];
    const ticks = [];
    for (const id of normalized) {
        const rel = `${P.PR_DIR}/${id}.pr`;
        if (!fs.existsSync(path.join(root, rel))) continue;
        for (const ref of P.parsePr(fs.readFileSync(path.join(root, rel), 'utf8'), rel).plans) ticks.push({ id, ...ref });
        fs.unlinkSync(path.join(root, rel));
        deleted.push(rel);
    }
    const text = P.serializeDismissed([...known, ...normalized]);
    const rel = `${P.PR_DIR}/${P.DISMISSED_FILE}`;
    const abs = path.join(root, rel);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (before !== text) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text);
    }
    const newlyDismissed = [...new Set(normalized.filter((id) => !known.has(id)))];
    const report = { file: rel, ids: P.parseDismissed(text).ids, newlyDismissed, deleted, ticks };
    const human = [`dismissed ${newlyDismissed.length} new id(s), deleted ${deleted.length} record(s); ${rel} holds ${report.ids.length}`];
    for (const file of deleted) human.push(`  deleted ${file}`);
    for (const tick of ticks) human.push(`warning: PR #${tick.id} ticked item ${tick.item} of plan ${tick.slug}; the tick leaves with its record, so mark the item verified first (lantern-plan, plan.mjs verified)`);
    human.push(`only merged or declined PRs should be dismissed (this command cannot check the state). Nothing is committed for you: git add ${P.PR_DIR}, commit, plain push.`);
    return { report, human };
}

function cmdTidy(root, flags) {
    if (!flags.base) throw new SyncError(`tidy needs --base <branch>\n${USAGE}`);
    const resolved = resolveBase(root, flags.base);
    const { duplicate, other } = untrackedMapFiles(root, resolved.sha);
    const dry = Boolean(flags['dry-run']);
    const deleted = [];
    if (!dry) {
        const stop = path.join(root, LANTERN_DIR);
        for (const file of duplicate) {
            fs.unlinkSync(path.join(root, file));
            deleted.push(file);
            let dir = path.dirname(path.join(root, file));
            while (dir !== stop && dir.startsWith(stop) && fs.readdirSync(dir).length === 0) {
                fs.rmdirSync(dir);
                dir = path.dirname(dir);
            }
        }
    }
    const report = { base: resolved.ref, dryRun: dry, duplicate, deleted, kept: other };
    const human = [`lantern-sync tidy (base ${resolved.ref}): ${dry ? 'would delete' : 'deleted'} ${duplicate.length} untracked ${LANTERN_DIR}/ file(s) identical to the base; kept ${other.length} that differ or are not in it`];
    for (const file of duplicate) human.push(`  ${dry ? 'duplicate' : 'deleted'} ${file}`);
    for (const file of other) human.push(`  kept ${file}`);
    return { report, human };
}

function runValidate(root) {
    const result = spawnSync(process.execPath, [path.join(setupDir, 'scripts', 'validate.mjs'), root, '--settled'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const problems = [];
    const warnings = [];
    let section = null;
    for (const line of output.split(/\r?\n/)) {
        if (/^FAIL: \d+ problem/.test(line)) section = problems;
        else if (/^warning: \d+/.test(line)) section = warnings;
        else if (!line.startsWith('  ')) section = null;
        else section?.push(line.trim());
    }
    return { ok: result.status === 0, status: result.status, problems, warnings, output };
}

function areasWarnings(root) {
    if (!fs.existsSync(path.join(root, AREAS_FILE))) return [];
    const run = spawnSync(process.execPath, [path.join(setupDir, 'scripts', 'areas.mjs'), root, 'check', '--allow-unassigned', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    let result;
    try {
        result = JSON.parse(run.stdout);
    } catch {
        const reason = `${run.stderr ?? ''}`.trim().split('\n')[0] || `exit ${run.status}`;
        return [`${AREAS_TAG} areas.mjs check could not run: ${reason}`];
    }
    const failed = result.rules.filter((rule) => rule.reasons.length).flatMap((rule) => rule.reasons.map((reason) => `${AREAS_TAG} ${rule.name}: ${reason}`));
    const unassigned = result.toAssign.map((id) => `${AREAS_TAG} feature "${id}" is under "To assign"; place it in an area in ${AREAS_FILE} (areas.mjs check --allow-unassigned)`);
    return [...failed, ...unassigned];
}

function touchedPlanFiles(root, cs) {
    const out = git(root, ['diff', '--name-only', '--relative', `${cs.baseSha}...HEAD`, '--', PlanRef.PLAN_DIR], { allowFail: true }) ?? '';
    return new Set(out.split('\n').filter(Boolean));
}

function planFileChecks(root, cs) {
    const check = planTools().run.runPlanJson(path.join(planDir, 'scripts', 'plan.mjs'), ['check', '--all', '--root', root]);
    if (check.failure) return { problems: [], warnings: [planSay('WARNING', 'SYNC_CHECK_FAILED', { reason: check.failure })] };
    const touched = touchedPlanFiles(root, cs);
    const problems = [];
    const warnings = [];
    for (const result of check.report.results) {
        if (touched.has(result.plan)) {
            problems.push(...result.errors);
            warnings.push(...result.warnings);
        } else warnings.push(...result.errors.map((text) => planSay('WARNING', 'SYNC_NOT_TOUCHED', { text })));
    }
    return { problems, warnings };
}

const REFERENCE_PROBLEMS = [
    [(found) => found.missing, 'SYNC_TICKS_NO_PLAN'],
    [(found, ref) => found.errors.length === 0 && !planItemIds(found.plan).includes(ref.item), 'SYNC_TICKS_NO_ITEM'],
];

function planReferenceWarnings(root, prs) {
    const warnings = [];
    const plans = new Map();
    for (const pr of prs) {
        for (const ref of pr.plans ?? []) {
            if (!plans.has(ref.slug)) plans.set(ref.slug, readPlan(root, ref.slug));
            const problem = REFERENCE_PROBLEMS.find(([broken]) => broken(plans.get(ref.slug), ref));
            if (problem) warnings.push(planSay('WARNING', problem[1], { file: pr.file, slug: ref.slug, item: ref.item, dir: PlanRef.PLAN_DIR }));
        }
    }
    return warnings;
}

function planVerification(root, cs, prs) {
    const planFolder = path.join(root, PlanRef.PLAN_DIR);
    const hasPlans = fs.existsSync(planFolder) && fs.readdirSync(planFolder).some((name) => name.endsWith(PlanRef.PLAN_EXT));
    const referencing = prs.filter((pr) => (pr.plans ?? []).length > 0);
    if (!hasPlans && referencing.length === 0) return { problems: [], warnings: [] };
    if (!Plan) return { problems: [], warnings: [`plans are in use here but lantern-plan is not installed beside lantern-sync, so they were not checked; ${PLAN_MISSING}`] };
    const files = hasPlans ? planFileChecks(root, cs) : { problems: [], warnings: [] };
    return { problems: files.problems, warnings: [...files.warnings, ...planReferenceWarnings(root, referencing)] };
}

function cmdVerify(root, flags) {
    requireMap(root);
    if (!flags.base) throw new SyncError(`verify needs --base <branch>\n${USAGE}`);
    const cs = changeSet(root, flags.base);
    const state = readState(root);
    const problems = [];
    for (const file of [...cs.added, ...cs.modified]) {
        if (!state.enumerated.has(file)) continue;
        const record = state.byPath.get(file);
        if (!record) problems.push(`${file}: changed in this branch but has no record`);
        else if (record.marker === '.' && state.hashOf(file) !== record.hash) problems.push(`${file}: changed in this branch and its record is stale`);
    }
    for (const file of cs.removed) {
        if (state.byPath.has(file) && !fs.existsSync(path.join(root, file))) problems.push(`${file}: removed in this branch but still has a record`);
    }
    const uncommitted = dirtySource(root);
    if (uncommitted.length) problems.push(`${uncommitted.length} uncommitted change(s) outside .lantern/ (${uncommitted.slice(0, 5).join(', ')}); verify checks what is committed`);
    const validate = runValidate(root);
    if (!validate.ok) {
        problems.push(`validate.mjs . --settled failed (exit ${validate.status}, ${validate.problems.length} problem(s))`);
        for (const problem of validate.problems) problems.push(`validate: ${problem}`);
    }
    const prs = P.listPrs(root);
    const branchRecords = P.listBranchRecords(root);
    for (const problem of P.summarize(prs).errors) problems.push(`pr record: ${problem}`);
    for (const problem of P.summarize(branchRecords).errors) problems.push(`branch record: ${problem}`);
    const records = [...prs, ...branchRecords];
    if (flags['require-pr']) {
        const branch = flags.branch ?? currentBranch(root);
        const record = records.find((pr) => pr.branch === branch);
        for (const file of addedProvenance(root, cs.mergeBase)) problems.push(`${file}: this branch adds a #model line or "model" field; the map records no model`);
        if (!record) problems.push(`${NO_RECORD} ${branch}`);
        else {
            const head = lastSourceCommit(root, cs.mergeBase);
            if (record.head !== head) problems.push(`${record.file}: #head is ${record.head}, the last source commit is ${head}; re-run sync.mjs pr`);
            const expected = new Set(prEntries(cs).map((e) => `${e.kind} ${e.path}`));
            const actual = new Set(record.files.map((f) => `${f.kind} ${L.encodePath(f.path)}`));
            const missing = [...expected].filter((e) => !actual.has(e));
            const extra = [...actual].filter((e) => !expected.has(e));
            for (const line of missing) problems.push(`${record.file}: lacks "${line}" from the change set`);
            for (const line of extra) problems.push(`${record.file}: lists "${line}", which is not in the change set`);
        }
    }
    const warnings = validate.warnings.filter((warning) => warning.includes(VOCABULARY_TAG) || warning.includes(RELATIONS_TAG));
    const planned = planVerification(root, cs, records);
    problems.push(...planned.problems);
    warnings.push(...planned.warnings);
    const partly = partlyMigrated(root);
    if (partly) warnings.push(partly);
    warnings.push(...areasWarnings(root));
    const reasonBranch = flags.branch ?? tryCurrentBranch(root);
    const reasonRecord = reasonBranch === null ? null : records.find((pr) => pr.branch === reasonBranch);
    if (reasonRecord && reasonRecord.file.startsWith(`${P.BRANCH_DIR}/`)) {
        const main = mainCheckout(root);
        if (main) {
            const target = path.join(main, reasonRecord.file);
            const copied = fs.existsSync(target) && fs.readFileSync(target, 'utf8') === fs.readFileSync(path.join(root, reasonRecord.file), 'utf8');
            if (!copied) problems.push(`${reasonRecord.file}: the project at ${main} has no identical copy, so the Lantern app shows this branch without its reasons; re-run sync.mjs pr (no id) with the same arguments, or run sync.mjs carry --from ${root} --branch ${reasonRecord.branch} in ${main}`);
        }
    }
    if (reasonRecord) {
        const unexplained = reasonRecord.files.filter((f) => !f.reason && !isExempt(f.path)).map((f) => f.path);
        if (unexplained.length) problems.push(unexplainedMessage(reasonRecord.file, unexplained, reasonRecord.files.length));
    } else if (flags['require-reason']) problems.push(`--require-reason needs ${NO_RECORD_NEEDED} ${reasonBranch ?? '(detached HEAD: pass --branch)'}`);
    if (reasonRecord) {
        const placed = new Set(reasonRecord.order);
        const unplaced = reasonRecord.files.filter((f) => !placed.has(f.path)).map((f) => f.path);
        if (unplaced.length) {
            const shown = unplaced.slice(0, 5).join(', ') + (unplaced.length > 5 ? `, +${unplaced.length - 5} more` : '');
            const message = `${reasonRecord.file}: ${unplaced.length} of ${reasonRecord.files.length} changed file(s) have no review position (${shown}); re-run sync.mjs pr with --order <path> in review order`;
            if (flags['require-order']) problems.push(message);
            else warnings.push(message);
        }
    } else if (flags['require-order']) problems.push(`--require-order needs ${NO_RECORD_NEEDED} ${reasonBranch ?? '(detached HEAD: pass --branch)'}`);
    if (flags['require-flow']) {
        if (!reasonRecord) problems.push(`--require-flow needs ${NO_RECORD_NEEDED} ${reasonBranch ?? '(detached HEAD: pass --branch)'}`);
        else if (reasonRecord.flow.length === 0 && reasonRecord.files.length > 0) problems.push(`${reasonRecord.file}: no flow (#story, #step, #below lines); re-run sync.mjs pr with --flow-file`);
    }
    if (reasonRecord && flowHasNoFiles(reasonRecord.flow)) warnings.push(`${reasonRecord.file}: no step of the flow points at a changed file (#file lines); add "files" to the steps in --flow-file where a file honestly implements one`);
    const ok = problems.length === 0;
    const report = { ok, base: cs.base, problems, warnings, changeSet: { added: cs.added, modified: cs.modified, removed: cs.removed } };
    const human = [`lantern-sync verify (base ${cs.base}): ${ok ? 'GREEN' : `RED, ${problems.length} problem(s)`}`];
    for (const problem of problems) human.push(`  ${problem}`);
    for (const warning of warnings) human.push(`warning: ${warning}`);
    return { report, human, exit: ok ? 0 : 1 };
}

function main() {
    const { positional, flags } = parseArgs(process.argv.slice(2));
    const [command, ...rest] = positional;
    const root = path.resolve(flags.root ?? '.');
    let result;
    if (command === 'status') result = cmdStatus(root, flags);
    else if (command === 'finish') result = cmdFinish(root, flags);
    else if (command === 'pr') result = cmdPr(root, rest, flags);
    else if (command === 'dismiss') result = cmdDismiss(root, rest);
    else if (command === 'tidy') result = cmdTidy(root, flags);
    else if (command === 'local') result = cmdLocal(root, flags);
    else if (command === 'carry') result = cmdCarry(root, flags);
    else if (command === 'verify') result = cmdVerify(root, flags);
    else throw new SyncError(USAGE);
    if (flags.json) process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    else process.stdout.write(`${result.human.join('\n')}\n`);
    process.exit(result.exit ?? 0);
}

try {
    main();
} catch (error) {
    if (!(error instanceof SyncError)) throw error;
    process.stderr.write(`lantern-sync: ${error.message}\n`);
    process.exit(error.code);
}

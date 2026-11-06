#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(here);
const syncScript = path.join(here, 'sync.mjs');
const setupDir = path.join(path.dirname(skillDir), 'lantern-setup');
const L = await import(pathToFileURL(path.join(setupDir, 'scripts', 'lib.mjs')).href);

const MODEL = 'claude-sonnet-5-5';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-sync-selftest-'));
let repo = path.join(tmp, 'project');
fs.mkdirSync(repo);

const env = {
    ...process.env,
    LANTERN_LANG: 'en',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Selftest',
    GIT_AUTHOR_EMAIL: 'selftest@example.invalid',
    GIT_COMMITTER_NAME: 'Selftest',
    GIT_COMMITTER_EMAIL: 'selftest@example.invalid',
};

let failures = 0;
let count = 0;

function check(name, condition, detail = '') {
    count++;
    if (condition) console.log(`ok ${count} - ${name}`);
    else {
        failures++;
        console.log(`not ok ${count} - ${name}${detail ? `\n    ${String(detail).split('\n').join('\n    ')}` : ''}`);
    }
}

function run(command, args, cwd = repo) {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const git = (...args) => {
    const result = run('git', args);
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
};
const sync = (...args) => run(process.execPath, [syncScript, ...args]);
const syncJson = (...args) => {
    const result = sync(...args, '--json');
    let json = null;
    try {
        json = JSON.parse(result.stdout);
    } catch {}
    return { ...result, json };
};
const setupScript = (name, ...args) => run(process.execPath, [path.join(setupDir, 'scripts', name), ...args]);
const write = (rel, text) => {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
};
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const listLantern = (dir = '.lantern') => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listLantern(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const exists = (rel) => fs.existsSync(path.join(repo, rel));
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function planHashes() {
    const hashes = new Map();
    const chunks = setupScript('plan.mjs', '.', 'chunks').stdout.split('\n').filter(Boolean).length;
    for (let id = 1; id <= chunks; id++) {
        for (const line of setupScript('plan.mjs', '.', 'chunk', String(id)).stdout.split('\n')) {
            if (!line || line.startsWith('#')) continue;
            const [encoded, hash] = line.split(' ');
            hashes.set(L.decodePath(encoded), hash);
        }
    }
    return hashes;
}

const spec = new Map();

function writeMapDir(dir) {
    const hashes = planHashes();
    const files = [...spec.entries()].filter(([p]) => L.dirOf(p) === dir).sort(([a], [b]) => (a < b ? -1 : 1));
    const mapFile = L.mapFileFor(files[0][0]);
    const lines = ['lantern 1', `# ${dir || '.'}`, ''];
    const text = {};
    for (const [p, entry] of files) {
        const name = L.encodePath(p.slice(p.lastIndexOf('/') + 1));
        lines.push(`${L.encodePath(p)} . ${entry.role} ${hashes.get(p)}`);
        text[name] = `purpose of ${name}`;
        for (const [arrow, target, label] of entry.rel ?? []) {
            lines.push(`  ${arrow} ${target}`);
            text[`${name} ${arrow} ${target}`] = label;
        }
    }
    write(mapFile, `${lines.join('\n')}\n`);
    write(`.lantern/lang/en/${mapFile.slice(L.MAP_DIR.length + 1)}.json`, `${JSON.stringify({ text }, null, 1)}\n`);
}

function seed() {
    git('init', '-q');
    git('symbolic-ref', 'HEAD', 'refs/heads/main');
    write('.gitignore', '.ai/\n');
    write('README.md', '# project\n');
    write('src/a.ts', "import { helperB } from './b';\nimport { legacy } from './old';\nexport const a = helperB() + legacy;\n");
    write('src/b.ts', 'export function helperB() {\n    return 1;\n}\n');
    write('src/c.ts', "import { thing } from './rename-me';\nexport const c = thing;\n");
    write('src/old.ts', 'export const legacy = 1;\n');
    write('src/rename-me.ts', 'export const thing = 2;\n');
    write('legacy/gone.ts', 'export const gone = 1;\n');
    write('lib/p.ts', 'export const p = 1;\n');
    write('lib/q.ts', "import { p } from './p';\nexport const q = p + 1;\n");
    spec.set('src/a.ts', { role: 'service', rel: [['=', 'src/b.ts#helperB', 'calls b'], ['=', 'src/old.ts#legacy', 'old thing']] });
    spec.set('src/b.ts', { role: 'util' });
    spec.set('src/c.ts', { role: 'service', rel: [['<', 'src/rename-me.ts#thing', 'the value']] });
    spec.set('src/old.ts', { role: 'util' });
    spec.set('src/rename-me.ts', { role: 'util' });
    spec.set('legacy/gone.ts', { role: 'util' });
    spec.set('lib/p.ts', { role: 'util' });
    spec.set('lib/q.ts', { role: 'util', rel: [['<', 'lib/p.ts#p', 'the base']] });
    writeMapDir('src');
    writeMapDir('legacy');
    writeMapDir('lib');
    git('add', '.gitignore', 'README.md', 'src', 'legacy', 'lib', '.lantern');
    git('commit', '-q', '-m', 'chore: base');
}

function featureBranch() {
    git('checkout', '-q', '-b', 'feature');
    write('src/new.ts', 'export const fresh = 1;\n');
    write('src/my file.ts', 'export const spaced = 1;\n');
    write('docs/notes#1.md', '# notes\n');
    write('src/b.ts', 'export function helperB() {\n    return 1;\n}\nexport const extra = 2;\n');
    write('lib/p.ts', 'export const p = 2;\n');
    write('README.md', '# project\n\nchanged\n');
    git('rm', '-q', 'src/old.ts', 'legacy/gone.ts');
    git('mv', 'src/rename-me.ts', 'src/renamed.ts');
    git('add', 'src/new.ts', 'src/my file.ts', 'docs/notes#1.md', 'src/b.ts', 'lib/p.ts', 'README.md');
    git('commit', '-q', '-m', 'feat: change things');
    return git('rev-parse', 'HEAD');
}

function reMapByHand() {
    spec.delete('src/old.ts');
    spec.delete('src/rename-me.ts');
    spec.delete('legacy/gone.ts');
    spec.set('src/new.ts', { role: 'util' });
    spec.set('src/my file.ts', { role: 'util' });
    spec.set('src/renamed.ts', { role: 'util' });
    spec.set('src/a.ts', { role: 'service', rel: [['=', 'src/b.ts#helperB', 'calls b']] });
    spec.set('src/c.ts', { role: 'service', rel: [['<', 'src/renamed.ts#thing', 'the value']] });
    writeMapDir('src');
    writeMapDir('lib');
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function useRepo(name) {
    repo = path.join(tmp, name);
    fs.mkdirSync(repo);
    spec.clear();
    git('init', '-q');
    git('symbolic-ref', 'HEAD', 'refs/heads/main');
}

function skillsBase() {
    write('.gitignore', '.ai/\n');
    write('README.md', '# skills\n');
    write('skills/commit/SKILL.md', '---\nname: commit\n---\nWrite short commit messages.\n');
    write('skills/deploy/SKILL.md', '---\nname: deploy\n---\nDelegates read protocol.md. Run `$D/scripts/preflight.mjs`. Commit with the `commit` skill.\n');
    write('skills/deploy/protocol.md', '# Deploy protocol\nSee SKILL.md and run $D/scripts/preflight.mjs.\n');
    write('skills/deploy/scripts/preflight.mjs', 'export function preflight() {\n    return [];\n}\n');
    spec.set('skills/commit/SKILL.md', { role: 'skill' });
    spec.set('skills/deploy/SKILL.md', {
        role: 'skill',
        rel: [
            ['@', 'skills/commit/SKILL.md', 'for the release commit'],
            ['@', 'skills/deploy/protocol.md', 'read first'],
            ['@', 'skills/deploy/scripts/preflight.mjs#preflight', ''],
        ],
    });
    spec.set('skills/deploy/protocol.md', {
        role: 'skill',
        rel: [
            ['@', 'skills/deploy/SKILL.md', ''],
            ['@', 'skills/deploy/scripts/preflight.mjs', ''],
        ],
    });
    spec.set('skills/deploy/scripts/preflight.mjs', { role: 'script' });
    for (const dir of ['skills/commit', 'skills/deploy', 'skills/deploy/scripts']) writeMapDir(dir);
    git('add', '.gitignore', 'README.md', 'skills', '.lantern');
    git('commit', '-q', '-m', 'chore: base');
}

function markdownNodes() {
    useRepo('skills-project');
    skillsBase();
    const chunks = setupScript('plan.mjs', '.', 'chunk', '1').stdout;
    check('markdown: plan.mjs chunks the skill files like source files', /skills\/commit\/SKILL\.md [0-9a-f]{12} \d+ done/.test(chunks) && /skills\/deploy\/protocol\.md [0-9a-f]{12} \d+ done/.test(chunks), chunks);
    const enumerated = setupScript('enumerate.mjs', '.').stdout.split('\n');
    check('markdown: a project README stays out of the map', !enumerated.includes('README.md') && enumerated.includes('skills/deploy/SKILL.md'), enumerated.join('\n'));
    const base = setupScript('validate.mjs', '.', '--settled');
    check('markdown: a hand-built skill map with @ references validates settled', base.status === 0 && /coverage 4\/4/.test(base.stdout), base.stdout);
    const quiet = syncJson('status');
    check('markdown: status on the clean tree shows no drift', quiet.status === 0 && sameList(quiet.json.drift, { changed: [], unmapped: [], gone: [] }), quiet.stdout);

    git('checkout', '-q', '-b', 'feature');
    write('skills/deploy/protocol.md', '# Deploy protocol\nSee SKILL.md and run $D/scripts/preflight.mjs.\nThen verify.\n');
    write('skills/deploy/scripts/preflight.mjs', 'export function check() {\n    return [];\n}\n');
    write('skills/review/SKILL.md', '---\nname: review\n---\nLoad the `deploy` skill first.\n');
    write('README.md', '# skills\n\nchanged\n');
    git('rm', '-q', 'skills/commit/SKILL.md');
    git('add', 'skills/deploy', 'skills/review', 'README.md');
    git('commit', '-q', '-m', 'feat: change skills');
    const featureCommit = git('rev-parse', 'HEAD');

    const status = syncJson('status', '--base', 'main');
    check(
        'markdown: status sees changed, added and removed skill files',
        sameList(status.json?.drift.changed, ['skills/deploy/protocol.md', 'skills/deploy/scripts/preflight.mjs']) && sameList(status.json?.drift.unmapped, ['skills/review/SKILL.md']) && sameList(status.json?.drift.gone, ['skills/commit/SKILL.md']),
        JSON.stringify(status.json?.drift),
    );
    const red = syncJson('verify', '--base', 'main');
    const redText = (red.json?.problems ?? []).join('\n');
    check(
        'markdown: verify is RED on a stale protocol record, a new skill and a removed one',
        red.status === 1 && /skills\/deploy\/protocol\.md: changed in this branch and its record is stale/.test(redText) && /skills\/review\/SKILL\.md: changed in this branch but has no record/.test(redText) && /skills\/commit\/SKILL\.md: removed in this branch but still has a record/.test(redText),
        redText,
    );

    const finish = syncJson('finish', '--base', 'main', '--model', MODEL);
    const listed = (finish.json?.workList ?? []).map((w) => w.path);
    check('markdown: finish lists the changed markdown, the new skill and the referrer, never the README', finish.status === 0 && sameList(listed, ['skills/deploy/SKILL.md', 'skills/deploy/protocol.md', 'skills/deploy/scripts/preflight.mjs', 'skills/review/SKILL.md']), listed.join('\n'));
    const reason = Object.fromEntries((finish.json?.workList ?? []).map((w) => [w.path, w.reasons.join(';')]));
    check(
        'markdown: a referrer is listed for an @ target that was removed and for a symbol that is gone',
        /skills\/commit\/SKILL\.md.*removed or renamed/.test(reason['skills/deploy/SKILL.md'] ?? '') && /preflight.*no longer in the target/.test(reason['skills/deploy/SKILL.md'] ?? ''),
        JSON.stringify(reason),
    );
    check(
        'markdown: finish removed the record and the empty map file of the removed skill',
        sameList(finish.json?.removal.removed, ['skills/commit/SKILL.md']) && !exists('.lantern/map/skills/commit.lantern') && !exists('.lantern/lang/en/skills/commit.lantern.json'),
        JSON.stringify(finish.json?.removal),
    );
    const hashes = planHashes();
    check('markdown: work list hashes are the ones plan.mjs prints', (finish.json?.workList ?? []).every((w) => w.hash === hashes.get(w.path)));

    spec.delete('skills/commit/SKILL.md');
    spec.set('skills/review/SKILL.md', { role: 'skill', rel: [['@', 'skills/deploy/SKILL.md', 'loads the deploy skill']] });
    spec.set('skills/deploy/SKILL.md', {
        role: 'skill',
        rel: [
            ['@', 'skills/deploy/protocol.md', 'read first'],
            ['@', 'skills/deploy/scripts/preflight.mjs#check', ''],
        ],
    });
    spec.set('skills/deploy/protocol.md', {
        role: 'skill',
        rel: [
            ['@', 'skills/deploy/SKILL.md', ''],
            ['@', 'skills/deploy/scripts/preflight.mjs', ''],
        ],
    });
    for (const dir of ['skills/deploy', 'skills/review', 'skills/deploy/scripts']) writeMapDir(dir);
    const settled = setupScript('validate.mjs', '.', '--settled');
    check('markdown: after the re-map validate.mjs --settled is green', settled.status === 0, settled.stdout);
    const done = syncJson('finish', '--base', 'main', '--model', MODEL);
    check('markdown: finish now prints an empty work list', done.status === 0 && sameList(done.json?.workList, []), JSON.stringify(done.json?.workList));
    check('markdown: verify is GREEN after the re-map', sync('verify', '--base', 'main').status === 0);
    git('add', '.lantern');
    git('commit', '-q', '-m', 'chore: update the Lantern map');

    const prArgs = ['pr', '7', '--url', 'https://bitbucket.org/acme/skills/pull-requests/7', '--title', 'feat: change skills', '--base', 'main', '--reason', 'skills/review/SKILL.md=A new skill that loads deploy.', '--reason', 'README.md=Lists the new skill.', '--reason', 'skills/deploy/protocol.md=Adds the review hand-off.', '--reason', 'skills/deploy/scripts/preflight.mjs=Renames the check.', '--reason', 'skills/commit/SKILL.md=Drops the retired skill.', '--order', 'skills/review/SKILL.md', '--order', 'skills/deploy/protocol.md'];
    const pr = sync(...prArgs);
    const record = exists('.lantern/prs/7.pr') ? read('.lantern/prs/7.pr') : '';
    check(
        'markdown: pr records the skill files with a reason and a position',
        pr.status === 0 && record.includes('+ skills/review/SKILL.md\n') && record.includes('~ skills/deploy/protocol.md\n') && record.includes('- skills/commit/SKILL.md\n') && record.includes('#reason skills/review/SKILL.md A new skill that loads deploy.\n') && record.includes('#order skills/review/SKILL.md\n') && record.includes(`#head ${featureCommit}`),
        record + pr.stderr,
    );
    git('add', '.lantern/prs/7.pr');
    git('commit', '-q', '-m', 'chore: record pull request #7 in the Lantern map');
    const gate = sync('verify', '--base', 'main', '--require-pr');
    check('markdown: verify --require-pr is GREEN with the record in the branch', gate.status === 0, gate.stdout);

    write('skills/deploy/protocol.md', '# Deploy protocol\nChanged again without the map.\n');
    git('add', 'skills/deploy/protocol.md');
    git('commit', '-q', '-m', 'fix: edit the protocol without the map');
    const stale = sync('verify', '--base', 'main', '--require-pr');
    check('markdown: a later edit to a protocol file turns verify RED until it is re-mapped', stale.status === 1 && /skills\/deploy\/protocol\.md: changed in this branch and its record is stale/.test(stale.stdout), stale.stdout);
}

function oldMapMeetsMarkdown() {
    useRepo('old-map');
    write('.gitignore', '.ai/\n');
    write('src/a.ts', 'export const a = 1;\n');
    spec.set('src/a.ts', { role: 'util' });
    writeMapDir('src');
    git('add', '.gitignore', 'src', '.lantern');
    git('commit', '-q', '-m', 'chore: base');
    check('old map: validates settled before any markdown exists', setupScript('validate.mjs', '.', '--settled').status === 0);
    write('skills/x/SKILL.md', '---\nname: x\n---\nDo the thing.\n');
    write('skills/x/references/notes.md', '# notes\n');
    write('CLAUDE.md', '# rules\n');
    write('docs/guide.md', '# guide\n');
    const status = syncJson('status');
    check(
        'old map: new markdown shows as new/unmapped drift, other markdown does not',
        status.status === 0 && sameList(status.json?.drift.unmapped, ['CLAUDE.md', 'skills/x/SKILL.md', 'skills/x/references/notes.md']) && sameList(status.json?.drift.changed, []) && sameList(status.json?.drift.gone, []),
        JSON.stringify(status.json?.drift),
    );
    const pending = setupScript('plan.mjs', '.', 'pending').stdout;
    const pendingFiles = [...pending.matchAll(/(\d+) pending/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    check('old map: plan.mjs pending counts exactly the three new markdown files', pendingFiles === 3, pending);
    const validate = setupScript('validate.mjs', '.');
    check('old map: validate reports each markdown file as unmapped and nothing else', validate.status === 1 && (validate.stdout.match(/^ {2}unmapped: /gm) ?? []).length === 3 && !/stale|dangling|not in the vocabulary/.test(validate.stdout), validate.stdout);
    check('old map: the existing records stay mapped', /coverage 1\/4/.test(validate.stdout), validate.stdout);
}

function plainProject() {
    write('.gitignore', '.ai/\n');
    write('src/a.ts', 'export const a = 1;\n');
    write('src/b.ts', 'export const b = 2;\n');
    spec.set('src/a.ts', { role: 'util' });
    spec.set('src/b.ts', { role: 'util' });
    writeMapDir('src');
    git('add', '.gitignore', 'src', '.lantern');
    git('commit', '-q', '-m', 'chore: base');
}

function mapOnlyAndStacked() {
    useRepo('map-only');
    plainProject();
    git('checkout', '-q', '-b', 'chore/map-refresh');
    const nothing = sync('pr', '9', '--url', 'https://bitbucket.org/acme/p/pull-requests/9', '--title', 'chore: refresh the map', '--base', 'main');
    check('map-only: a branch that changed nothing at all is still refused', nothing.status === 1 && /nothing changed/.test(nothing.stderr), nothing.stderr);

    const langFile = '.lantern/lang/en/src.lantern.json';
    write(langFile, read(langFile).replace('purpose of a.ts', 'the constant a, re-described'));
    git('add', '.lantern');
    git('commit', '-q', '-m', 'chore: update the Lantern map');
    const noRecord = sync('verify', '--base', 'main', '--require-pr');
    check('map-only: verify --require-pr is RED while the record is missing', noRecord.status === 1 && /no \.lantern\/prs\/\*\.pr record/.test(noRecord.stdout), noRecord.stdout);
    const pr = sync('pr', '9', '--url', 'https://bitbucket.org/acme/p/pull-requests/9', '--title', 'chore: refresh the map', '--base', 'main');
    const record = exists('.lantern/prs/9.pr') ? read('.lantern/prs/9.pr') : '';
    const sourceHead = git('rev-list', '-1', 'HEAD', '--', '.', ':(exclude).lantern');
    check('map-only: pr writes a record with no file lines, a default summary and the last source commit as #head', pr.status === 0 && !/^[+~-] /m.test(record) && record.includes('#summary Lantern map only') && record.includes(`#head ${sourceHead}`), record + pr.stderr);
    git('add', '.lantern/prs/9.pr');
    git('commit', '-q', '-m', 'chore: record pull request #9 in the Lantern map');
    const gate = sync('verify', '--base', 'main', '--require-pr', '--require-reason', '--require-order', '--require-flow');
    check('map-only: verify --require-pr --require-reason --require-order --require-flow is GREEN with the record in the branch', gate.status === 0, gate.stdout);
    const again = sync('pr', '9', '--url', 'https://bitbucket.org/acme/p/pull-requests/9', '--title', 'chore: refresh the map', '--base', 'main');
    check('map-only: re-running pr after the record commit rewrites the same record', again.status === 0 && read('.lantern/prs/9.pr') === record, again.stderr);

    git('checkout', '-q', '-b', 'feat/follow-up');
    write('src/b.ts', 'export const b = 3;\n');
    git('add', 'src/b.ts');
    git('commit', '-q', '-m', 'feat: follow-up on the unmerged map refresh');
    writeMapDir('src');
    write(langFile, read(langFile).replace('purpose of a.ts', 'the constant a, re-described'));
    git('add', '.lantern');
    git('commit', '-q', '-m', 'chore: update the Lantern map');
    const stackedPr = sync('pr', '10', '--url', 'https://bitbucket.org/acme/p/pull-requests/10', '--title', 'feat: follow-up', '--base', 'chore/map-refresh', '--reason', 'src/b.ts=Changes the constant the next task needs.', '--order', 'src/b.ts');
    const stackedRecord = exists('.lantern/prs/10.pr') ? read('.lantern/prs/10.pr') : '';
    check('stacked: a PR based on an unmerged branch lists only its own files and names that base', stackedPr.status === 0 && stackedRecord.includes('#base chore/map-refresh') && stackedRecord.includes('~ src/b.ts\n') && !/^[+~-] src\/a\.ts/m.test(stackedRecord), stackedRecord + stackedPr.stderr);
    git('add', '.lantern/prs/10.pr');
    git('commit', '-q', '-m', 'chore: record pull request #10 in the Lantern map');
    const stackedGate = sync('verify', '--base', 'chore/map-refresh', '--require-pr', '--require-reason', '--require-order');
    check('stacked: verify against the unmerged base branch is GREEN', stackedGate.status === 0, stackedGate.stdout);
}

function missingReasonsAndExemptFiles() {
    useRepo('why-gate');
    plainProject();
    git('checkout', '-q', '-b', 'feat/why');
    write('src/b.ts', 'export const b = 7;\n');
    write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
    write('assets/logo.png', 'not really a png\n');
    git('add', 'src/b.ts', 'pnpm-lock.yaml', 'assets/logo.png');
    git('commit', '-q', '-m', 'feat: change b with a lockfile and an asset');
    writeMapDir('src');
    git('add', '.lantern');
    git('commit', '-q', '-m', 'chore: update the Lantern map');
    const args = ['pr', '21', '--url', 'https://bitbucket.org/acme/p/pull-requests/21', '--title', 'feat: change b', '--base', 'main', '--branch', 'feat/why', '--order', 'src/b.ts'];

    const missing = sync(...args);
    check('why gate: a changed source file with no reason makes pr exit 1, name the file and write nothing', missing.status === 1 && /^ {2}src\/b\.ts$/m.test(missing.stderr) && !exists('.lantern/prs/21.pr'), missing.stderr);
    check('why gate: the lockfile and the asset are not listed as missing', !/pnpm-lock|logo\.png/.test(missing.stderr) && /1 of 3 changed file\(s\)/.test(missing.stderr), missing.stderr);
    const complete = sync(...args, '--reason', 'src/b.ts=Raises the constant b for the new limit.');
    const record = exists('.lantern/prs/21.pr') ? read('.lantern/prs/21.pr') : '';
    check('why gate: with a reason for the source file, exempt files pass and get the default reason', complete.status === 0 && /#reason pnpm-lock\.yaml Lockfile, asset or generated file/.test(record) && /#reason assets\/logo\.png Lockfile, asset or generated file/.test(record) && record.includes('#reason src/b.ts Raises the constant b'), complete.stderr + record);
    git('add', '.lantern/prs/21.pr');
    git('commit', '-q', '-m', 'chore: record pull request #21 in the Lantern map');
    const green = sync('verify', '--base', 'main', '--branch', 'feat/why', '--require-pr', '--require-reason');
    check('why gate: verify --require-pr --require-reason is GREEN with the exempt files', green.status === 0, green.stdout);

    write('.lantern/prs/21.pr', record.split('\n').filter((line) => !line.startsWith('#reason ')).join('\n'));
    git('add', '.lantern/prs/21.pr');
    git('commit', '-q', '-m', 'chore: hand-edit the record');
    const red = sync('verify', '--base', 'main', '--branch', 'feat/why', '--require-pr');
    check('why gate: a hand-written record with no reasons is RED without --require-reason, naming only the non-exempt file', red.status === 1 && /1 of 3 changed file\(s\) have no reason \(src\/b\.ts\)/.test(red.stdout), red.stdout);
}

function recordForAnOpenPr() {
    useRepo('open-pr');
    plainProject();
    git('checkout', '-q', '-b', 'feat/open');
    write('src/b.ts', 'export const b = 5;\n');
    git('add', 'src/b.ts');
    git('commit', '-q', '-m', 'feat: change b');
    writeMapDir('src');
    git('add', '.lantern');
    git('commit', '-q', '-m', 'chore: update the Lantern map');
    git('checkout', '-q', 'main');
    const wt = path.join(tmp, 'open-pr-worktree');
    git('worktree', 'add', '-q', '--detach', wt, 'feat/open');
    const pr = sync('pr', '11', '--url', 'https://bitbucket.org/acme/p/pull-requests/11', '--title', 'feat: change b', '--base', 'main', '--branch', 'feat/open', '--reason', 'src/b.ts=Changes the constant b.', '--order', 'src/b.ts', '--root', wt);
    check('open PR: pr writes the record from a detached worktree on the PR branch', pr.status === 0 && fs.existsSync(path.join(wt, '.lantern/prs/11.pr')), pr.stderr);
    run('git', ['add', '.lantern/prs/11.pr'], wt);
    run('git', ['commit', '-q', '-m', 'chore: record pull request #11 in the Lantern map'], wt);
    const gate = sync('verify', '--base', 'main', '--branch', 'feat/open', '--require-pr', '--require-reason', '--require-order', '--root', wt);
    check('open PR: verify --require-pr is GREEN in that worktree, and the main checkout was never touched', gate.status === 0 && !exists('.lantern/prs/11.pr') && git('rev-parse', '--abbrev-ref', 'HEAD') === 'main', gate.stdout);
    git('worktree', 'remove', '--force', wt);
}

function vocabularyOnVerify() {
    useRepo('vocabulary');
    plainProject();
    git('checkout', '-q', '-b', 'feat/vocab');
    write('.lantern/systems', '# outside systems\nmail-relay\n');
    spec.set('src/a.ts', { role: 'util', rel: [['>', 'ext:mail-relay-api', 'sends mail']] });
    writeMapDir('src');
    git('add', '.lantern');
    git('commit', '-q', '-m', 'chore: update the Lantern map');
    const warned = syncJson('verify', '--base', 'main');
    check('vocabulary: verify stays GREEN on an unlisted ext target but surfaces the warning with file:line', warned.status === 0 && warned.json?.ok === true && (warned.json?.warnings ?? []).some((w) => /\.lantern\/map\/src\.lantern:\d+: \[vocabulary\] ext:mail-relay-api is not in \.lantern\/systems \(did you mean ext:mail-relay\?\); reuse/.test(w)), warned.stdout);
    check('vocabulary: the human report prints it as a warning line', /^warning: .*\[vocabulary\]/m.test(sync('verify', '--base', 'main').stdout));
    spec.set('src/a.ts', { role: 'util', rel: [['>', 'ext:mail-relay', 'sends mail']] });
    writeMapDir('src');
    git('add', '.lantern');
    git('commit', '-q', '-m', 'chore: use the listed system');
    const clean = syncJson('verify', '--base', 'main');
    check('vocabulary: a map that uses the listed id produces no vocabulary warning', clean.status === 0 && !(clean.json?.warnings ?? []).some((w) => /\[vocabulary\]/.test(w)), clean.stdout);
}

function strayAfterSeed() {
    useRepo('seeded');
    write('.gitignore', '.ai/\n');
    write('src/a.ts', 'export const a = 1;\n');
    git('add', '.gitignore', 'src');
    git('commit', '-q', '-m', 'chore: base');
    spec.set('src/a.ts', { role: 'util' });
    writeMapDir('src');
    const before = syncJson('status', '--base', 'main');
    check('seed: while the map is untracked on the base, nothing is reported as a stray', before.status === 0 && before.json?.untracked === true && sameList(before.json?.untrackedDuplicates, []), before.stdout);
    git('add', '.lantern');
    git('commit', '-q', '-m', 'chore: add the Lantern map');
    git('branch', 'merged');
    git('reset', '-q', '--mixed', 'HEAD~1');
    write('.lantern/notes.txt', 'mine\n');
    const status = syncJson('status', '--base', 'merged');
    const duplicates = status.json?.untrackedDuplicates ?? [];
    check('seed: after the merge status names the untracked copies and the command that clears them', status.status === 0 && duplicates.length >= 2 && !duplicates.includes('.lantern/notes.txt') && /run sync\.mjs tidy --base merged/.test(sync('status', '--base', 'merged').stdout), JSON.stringify(duplicates));
    const blocked = run('git', ['merge', '--ff-only', 'merged']);
    check('seed: before tidy, git refuses to merge over the untracked copies', blocked.status !== 0, blocked.stderr);
    const dry = syncJson('tidy', '--base', 'merged', '--dry-run');
    check('seed: tidy --dry-run lists and deletes nothing', dry.status === 0 && dry.json?.duplicate.length === duplicates.length && dry.json?.deleted.length === 0 && exists('.lantern/map/src.lantern'), dry.stdout);
    const tidy = syncJson('tidy', '--base', 'merged');
    check('seed: tidy deletes the identical untracked copies and keeps the file the base lacks', tidy.status === 0 && tidy.json?.deleted.length === duplicates.length && sameList(tidy.json?.kept, ['.lantern/notes.txt']) && !exists('.lantern/map') && exists('.lantern/notes.txt'), tidy.stdout);
    const merged = run('git', ['merge', '--ff-only', 'merged']);
    check('seed: after tidy the merge goes through and the tracked map is back', merged.status === 0 && exists('.lantern/map/src.lantern'), merged.stderr);
    write('.lantern/lang/en/src.lantern.json', `${read('.lantern/lang/en/src.lantern.json').trimEnd()}\n\n`);
    const edited = syncJson('tidy', '--base', 'merged');
    check('seed: tidy never touches a tracked file, even an edited one', edited.status === 0 && edited.json?.deleted.length === 0 && exists('.lantern/lang/en/src.lantern.json'), edited.stdout);
}

try {
    seed();
    check('fixture: hand-built map validates settled before any change', setupScript('validate.mjs', '.', '--settled').status === 0, setupScript('validate.mjs', '.', '--settled').stdout);
    const quiet = syncJson('status');
    check('status on a clean tree: no drift', quiet.status === 0 && sameList(quiet.json.drift, { changed: [], unmapped: [], gone: [] }), quiet.stdout);

    const featureCommit = featureBranch();

    const status = syncJson('status', '--base', 'main');
    check('status exits 0', status.status === 0, status.stderr);
    const cs = status.json?.changeSet;
    check('status: added = new, spaced name, renamed target, unmapped notes file', sameList(cs?.added, ['docs/notes#1.md', 'src/my file.ts', 'src/new.ts', 'src/renamed.ts']), JSON.stringify(cs));
    check('status: modified', sameList(cs?.modified, ['README.md', 'lib/p.ts', 'src/b.ts']), JSON.stringify(cs));
    check('status: removed = deleted files and the rename source', sameList(cs?.removed, ['legacy/gone.ts', 'src/old.ts', 'src/rename-me.ts']), JSON.stringify(cs));
    check('status: rename reported as a pair', sameList(cs?.renamed, [{ from: 'src/rename-me.ts', to: 'src/renamed.ts' }]), JSON.stringify(cs));
    check('status: drift changed', sameList(status.json?.drift.changed, ['lib/p.ts', 'src/b.ts']), JSON.stringify(status.json?.drift));
    check('status: drift new/unmapped', sameList(status.json?.drift.unmapped, ['src/my file.ts', 'src/new.ts', 'src/renamed.ts']), JSON.stringify(status.json?.drift));
    check('status: drift gone', sameList(status.json?.drift.gone, ['legacy/gone.ts', 'src/old.ts', 'src/rename-me.ts']), JSON.stringify(status.json?.drift));
    const humanStatus = sync('status', '--base', 'main');
    check('status: no migration warning on a map without #model', !/partly migrated/.test(humanStatus.stdout), humanStatus.stdout);
    check('status: human report names the change set', humanStatus.status === 0 && /change set main\.\.\.HEAD.*\+4 ~3 -3/.test(humanStatus.stdout), humanStatus.stdout);

    const red = syncJson('verify', '--base', 'main');
    check('verify is RED (exit 1) on the un-updated branch', red.status === 1 && red.json?.ok === false, red.stdout);
    const redText = (red.json?.problems ?? []).join('\n');
    check('verify names a stale record', /src\/b\.ts: changed in this branch and its record is stale/.test(redText), redText);
    check('verify names a missing record', /src\/new\.ts: changed in this branch but has no record/.test(redText), redText);
    check('verify names a removed file that still has a record', /src\/old\.ts: removed in this branch but still has a record/.test(redText), redText);
    check('verify also fails on validate.mjs', /validate\.mjs \. --settled failed/.test(redText), redText);

    const mapBefore = read('.lantern/map/src.lantern');
    const floor = sync('finish', '--base', 'main', '--model', 'claude-haiku-5-5');
    check('finish refuses a model outside the accepted families and changes nothing', floor.status === 2 && /not an accepted model/.test(floor.stderr) && read('.lantern/map/src.lantern') === mapBefore, floor.stderr);

    const provenanceFree = listLantern().filter((rel) => !/^#model(\s|$)|^\s*"model"\s*:/m.test(read(rel)));
    const finish = syncJson('finish', '--base', 'main', '--model', MODEL);
    check('finish exits 0', finish.status === 0, finish.stderr);
    check('finish never writes #model or "model"', provenanceFree.filter(exists).every((rel) => !/^#model(\s|$)|^\s*"model"\s*:/m.test(read(rel))), provenanceFree.join('\n'));
    check('finish removed exactly the records of deleted files', sameList(finish.json?.removal.removed, ['legacy/gone.ts', 'src/old.ts', 'src/rename-me.ts']), JSON.stringify(finish.json?.removal));
    check('finish deleted the map file that became empty', sameList(finish.json?.removal.deletedMapFiles, ['.lantern/map/legacy.lantern']) && !exists('.lantern/map/legacy.lantern'), JSON.stringify(finish.json?.removal));
    check('finish deleted that map file\'s text file', !exists('.lantern/lang/en/legacy.lantern.json'));
    check('finish kept the map and lang folders that still hold files', exists('.lantern/map/src.lantern') && exists('.lantern/lang/en/src.lantern.json'));
    const srcMap = read('.lantern/map/src.lantern');
    check('finish removed old.ts and rename-me.ts records, kept the rest', !/^src\/old\.ts /m.test(srcMap) && !/^src\/rename-me\.ts /m.test(srcMap) && /^src\/b\.ts /m.test(srcMap) && /^src\/a\.ts /m.test(srcMap), srcMap);
    const srcText = JSON.parse(read('.lantern/lang/en/src.lantern.json')).text;
    check('finish dropped the text keys of removed files only', !('old.ts' in srcText) && !('rename-me.ts' in srcText) && 'b.ts' in srcText && 'a.ts = src/old.ts#legacy' in srcText, JSON.stringify(srcText));
    check('finish kept the lang file format (one-space indent, trailing newline)', /^\{\n "text"/.test(read('.lantern/lang/en/src.lantern.json')) && read('.lantern/lang/en/src.lantern.json').endsWith('}\n'));
    const listed = (finish.json?.workList ?? []).map((w) => w.path);
    check('finish work list is exactly the touched files and their referrers', sameList(listed, ['lib/p.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/my file.ts', 'src/new.ts', 'src/renamed.ts']), listed.join('\n'));
    const reason = Object.fromEntries((finish.json?.workList ?? []).map((w) => [w.path, w.reasons.join(';')]));
    check('work list: referrers carry the relation reason', /src\/old\.ts.*removed or renamed/.test(reason['src/a.ts'] ?? '') && /src\/rename-me\.ts.*removed or renamed/.test(reason['src/c.ts'] ?? ''), JSON.stringify(reason));
    check('work list: unchanged files next to a changed one stay off the list', !listed.includes('lib/q.ts'), listed.join('\n'));
    check('work list: README.md and the notes file are not mapped, so not listed', !listed.includes('README.md') && !listed.includes('docs/notes#1.md'));
    const hashes = planHashes();
    check('work list hashes are the ones plan.mjs prints', (finish.json?.workList ?? []).every((w) => w.hash === hashes.get(w.path)));
    const again = syncJson('finish', '--base', 'main', '--model', MODEL);
    check('finish is idempotent before the re-map', again.status === 0 && again.json?.removal.removed.length === 0 && sameList((again.json?.workList ?? []).map((w) => w.path), listed), JSON.stringify(again.json?.removal));
    const oldModel = sync('finish', '--base', 'main', '--model', 'claude-sonnet-4-5');
    check('finish warns about a model below the recommended version and still lists the work', oldModel.status === 0 && /note: model claude-sonnet-4-5 is below the recommended sonnet 5\.5; the re-map goes ahead/.test(oldModel.stdout) && /WORK LIST: /.test(oldModel.stdout), oldModel.stdout + oldModel.stderr);
    check('finish says nothing about the recommendation for a current model', !/recommended/.test(sync('finish', '--base', 'main', '--model', MODEL).stdout));
    const codexOld = sync('finish', '--base', 'main', '--model', 'gpt-6-sol', '--provider', 'codex');
    check('finish on the Codex route warns about an older Sol and still lists the work', codexOld.status === 0 && /note: model gpt-6-sol is below the recommended sol 6\.1; the re-map goes ahead/.test(codexOld.stdout) && /WORK LIST: /.test(codexOld.stdout), codexOld.stdout + codexOld.stderr);
    check('finish on the Codex route says nothing about a current Sol', !/recommended/.test(sync('finish', '--base', 'main', '--model', 'gpt-6.1-sol', '--provider', 'codex').stdout));
    check('finish on the Codex route accepts a Terra id without a note', (() => {
        const codexTerra = sync('finish', '--base', 'main', '--model', 'gpt-6-terra', '--provider', 'codex');
        return codexTerra.status === 0 && !/recommended/.test(codexTerra.stdout) && /WORK LIST: /.test(codexTerra.stdout);
    })());
    const codexUnknown = sync('finish', '--base', 'main', '--model', 'gpt-4o', '--provider', 'codex');
    check('finish on the Codex route refuses an unlisted model', codexUnknown.status === 2 && /not an accepted model/.test(codexUnknown.stderr), codexUnknown.stderr);
    const solOnClaude = sync('finish', '--base', 'main', '--model', 'gpt-6.1-sol');
    check('finish on the Claude route refuses a Sol model', solOnClaude.status === 2 && /only on the Codex route/.test(solOnClaude.stderr), solOnClaude.stderr);
    check('finish did not commit or push', git('status', '--porcelain', '.lantern') !== '' && git('rev-parse', 'HEAD') === featureCommit);
    check('verify is still RED before the re-map', sync('verify', '--base', 'main').status === 1);

    reMapByHand();
    const settled = setupScript('validate.mjs', '.', '--settled');
    check('after the hand re-map validate.mjs --settled is green', settled.status === 0, settled.stdout);
    const done = syncJson('finish', '--base', 'main', '--model', MODEL);
    check('finish now prints an empty work list', done.status === 0 && sameList(done.json?.workList, []) && /WORK LIST EMPTY/.test(sync('finish', '--base', 'main', '--model', MODEL).stdout), JSON.stringify(done.json?.workList));
    const green = sync('verify', '--base', 'main');
    check('verify is GREEN (exit 0) after the map is updated', green.status === 0 && /GREEN/.test(green.stdout), green.stdout);
    check('verify --require-pr is RED while there is no PR record', sync('verify', '--base', 'main', '--require-pr').status === 1);

    git('add', '.lantern');
    git('commit', '-q', '-m', 'chore: update the Lantern map');
    const mapCommit = git('rev-parse', 'HEAD');

    const ALL_FILES = ['docs/notes#1.md', 'src/my file.ts', 'src/new.ts', 'src/renamed.ts', 'README.md', 'lib/p.ts', 'src/b.ts', 'legacy/gone.ts', 'src/old.ts', 'src/rename-me.ts'];
    const allReasons = {};
    for (const file of ALL_FILES) allReasons[file] = `Why ${file} changed.`;
    allReasons['docs/notes#1.md'] = 'Explain the rollout.';
    allReasons['src/my file.ts'] = 'Spaces in names must survive.';
    allReasons['src/new.ts'] = 'Adds the new module.';
    allReasons['README.md'] = 'Document the new flag.';
    allReasons['lib/p.ts'] = 'Keep the helper pure.\nNo side effects.';
    const reasonFile = path.join(tmp, 'reason.json');
    fs.writeFileSync(reasonFile, JSON.stringify(allReasons));
    const baseArgs = ['pr', '42', '--url', 'https://bitbucket.org/acme/app/pull-requests/42', '--title', 'feat: change things', '--base', 'main', '--summary', 'one line'];
    const noReasons = sync(...baseArgs);
    check(
        'pr REFUSES (exit 1) to write a record while changed files have no reason, and names every one of them',
        noReasons.status === 1 && !exists('.lantern/prs/42.pr') && /10 of 10 changed file\(s\) have no reason/.test(noReasons.stderr) && ALL_FILES.every((file) => noReasons.stderr.includes(file)),
        noReasons.stderr,
    );
    const onlyOne = sync(...baseArgs, '--reason', 'src/b.ts=Changes the constant b.');
    check('pr refuses when only some files have a reason, listing the rest and not the explained one', onlyOne.status === 1 && !exists('.lantern/prs/42.pr') && /9 of 10 changed file\(s\)/.test(onlyOne.stderr) && !/^ {2}src\/b\.ts$/m.test(onlyOne.stderr) && /^ {2}src\/new\.ts$/m.test(onlyOne.stderr), onlyOne.stderr);
    const prArgs = [...baseArgs, '--reason-file', reasonFile];
    const pr = sync(...prArgs);
    check('pr exits 0 once every file has a reason', pr.status === 0, pr.stderr);
    const expected = [
        'lantern-pr 1',
        '# 42',
        '#title feat: change things',
        '#url https://bitbucket.org/acme/app/pull-requests/42',
        '#branch feature',
        '#base main',
        `#opened ${today()}`,
        `#head ${featureCommit}`,
        '#summary one line',
        '+ docs/notes%231.md',
        '+ src/my%20file.ts',
        '+ src/new.ts',
        '+ src/renamed.ts',
        '~ README.md',
        '~ lib/p.ts',
        '~ src/b.ts',
        '- legacy/gone.ts',
        '- src/old.ts',
        '- src/rename-me.ts',
        '',
    ].join('\n');
    const full = exists('.lantern/prs/42.pr') ? read('.lantern/prs/42.pr') : '';
    check('pr record is byte-exact against the grammar (its file lines, before the reasons)', full.split('\n').filter((line) => !line.startsWith('#reason ')).join('\n') === expected, full);
    check('#head is the last source commit, not the map commit on top of it', featureCommit !== mapCommit && full.includes(`#head ${featureCommit}`));
    const prsCheck = setupScript('prs.mjs', '.');
    check('prs.mjs accepts the record', prsCheck.status === 0 && /^OK$/m.test(prsCheck.stdout) && !/warning/.test(prsCheck.stdout), prsCheck.stdout);
    check('validate.mjs --settled still green with the record', setupScript('validate.mjs', '.', '--settled').status === 0);
    check('pr did not commit', git('rev-parse', 'HEAD') === mapCommit && git('status', '--porcelain', '.lantern').startsWith('?? .lantern/prs/'));

    const other = sync(...prArgs, '--branch', 'other-branch');
    check('pr refuses to overwrite a record of another branch', other.status === 1 && /refusing to overwrite/.test(other.stderr) && read('.lantern/prs/42.pr') === full, other.stderr);
    const second = sync('pr', '43', '--url', 'https://bitbucket.org/acme/app/pull-requests/43', '--title', 't', '--base', 'main', '--reason-file', reasonFile);
    check('pr refuses a second record for the same branch', second.status === 1 && !exists('.lantern/prs/43.pr'), second.stderr);
    write('.lantern/prs/42.pr', full.replace(`#opened ${today()}`, '#opened 2026-01-02').replace(featureCommit, '0'.repeat(40)));
    const rerun = sync(...prArgs);
    check('pr re-run for the same id and branch refreshes #head but keeps #opened', rerun.status === 0 && read('.lantern/prs/42.pr') === full.replace(`#opened ${today()}`, '#opened 2026-01-02'), rerun.stderr);
    write('.lantern/prs/42.pr', full);
    const noTitle = sync('pr', '44', '--url', 'u', '--base', 'main', '--branch', 'x');
    check('pr without --title fails with usage', noTitle.status === 2 && /--title is required/.test(noTitle.stderr), noTitle.stderr);

    git('add', '.lantern/prs/42.pr');
    git('commit', '-q', '-m', 'chore: record pull request #42 in the Lantern map');
    const touchedByPrCommit = git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
    check('the PR-record commit touches only .lantern/', touchedByPrCommit.length > 0 && touchedByPrCommit.every((f) => f.startsWith('.lantern/')), touchedByPrCommit.join('\n'));
    const gate = sync('verify', '--base', 'main', '--require-pr');
    check('verify --require-pr is GREEN once the record is in the branch', gate.status === 0, gate.stdout);

    write('.lantern/prs/42.pr', expected);
    const needReason = sync('verify', '--base', 'main', '--require-pr');
    check('verify is RED on a record whose files lack a reason, even without --require-reason, and names them', needReason.status === 1 && /10 of 10 changed file\(s\) have no reason \(docs\/notes#1\.md/.test(needReason.stdout) && !/^warning: .*no reason/m.test(needReason.stdout), needReason.stdout);
    const needReasonFlag = sync('verify', '--base', 'main', '--require-pr', '--require-reason');
    check('verify --require-reason is RED on the same record', needReasonFlag.status === 1 && /10 of 10 changed file\(s\) have no reason/.test(needReasonFlag.stdout), needReasonFlag.stdout);
    write('.lantern/prs/42.pr', full);
    const withReason = (...extra) => sync(...prArgs, ...extra);
    const longReason = 'x'.repeat(161);
    const tooLong = withReason('--reason', `src/new.ts=${longReason}`);
    check('pr --reason refuses a reason over 160 characters and leaves the record alone', tooLong.status === 2 && /cap is 160/.test(tooLong.stderr) && read('.lantern/prs/42.pr') === full, tooLong.stderr);
    const capped = withReason('--reason', `src/new.ts=${'y'.repeat(160)}`);
    check('pr --reason accepts exactly 160 characters', capped.status === 0 && read('.lantern/prs/42.pr').includes(`#reason src/new.ts ${'y'.repeat(160)}\n`), capped.stderr);
    const strayPath = withReason('--reason', 'src/nope.ts=because');
    check('pr --reason refuses a path the pull request does not change', strayPath.status === 2 && /must be <path>=<reason>/.test(strayPath.stderr), strayPath.stderr);
    const control = withReason('--reason', 'src/new.ts=bad\u0001char');
    check('pr --reason refuses a control character', control.status === 2 && /control character/.test(control.stderr), control.stderr);

    const withReasons = withReason();
    check('pr --reason-file covering every file exits 0', withReasons.status === 0 && /10\/10 with a reason/.test(withReasons.stdout), withReasons.stderr + withReasons.stdout);
    const recorded = read('.lantern/prs/42.pr');
    const reasonLines = recorded.split('\n').filter((line) => line.startsWith('#reason '));
    check(
        '#reason lines follow the file lines in file order, paths encoded, a multi-line reason folded to one line',
        sameList(reasonLines, [
            '#reason docs/notes%231.md Explain the rollout.',
            '#reason src/my%20file.ts Spaces in names must survive.',
            '#reason src/new.ts Adds the new module.',
            '#reason src/renamed.ts Why src/renamed.ts changed.',
            '#reason README.md Document the new flag.',
            '#reason lib/p.ts Keep the helper pure. No side effects.',
            '#reason src/b.ts Why src/b.ts changed.',
            '#reason legacy/gone.ts Why legacy/gone.ts changed.',
            '#reason src/old.ts Why src/old.ts changed.',
            '#reason src/rename-me.ts Why src/rename-me.ts changed.',
        ]) && recorded.indexOf('- src/rename-me.ts') < recorded.indexOf('#reason '),
        recorded,
    );
    const withReasonsCheck = setupScript('prs.mjs', '.');
    check('prs.mjs accepts a record with reasons and prints no warning', withReasonsCheck.status === 0 && /^OK$/m.test(withReasonsCheck.stdout) && !/warning/.test(withReasonsCheck.stdout), withReasonsCheck.stdout);
    const stripped = recorded.split('\n').filter((line) => !line.startsWith('#reason ')).join('\n');
    check('a record without its #reason lines is exactly the old grammar', stripped === expected);

    const refreshed = sync(...baseArgs);
    check('pr re-run without --reason keeps every reason', refreshed.status === 0 && read('.lantern/prs/42.pr') === recorded, refreshed.stderr);
    const dropped = withReason('--reason', 'src/new.ts=');
    check('an empty --reason would leave a file without a reason, so pr refuses and keeps the record', dropped.status === 1 && /1 of 10 changed file\(s\) have no reason:\n {2}src\/new\.ts/.test(dropped.stderr) && read('.lantern/prs/42.pr') === recorded, dropped.stderr);
    const explained = sync('verify', '--base', 'main', '--require-pr', '--require-reason');
    check('verify --require-reason is GREEN once every file has a reason', explained.status === 0 && !/no reason/.test(explained.stdout), explained.stdout);
    const noPosition = sync('verify', '--base', 'main', '--require-pr', '--require-order');
    check('verify --require-order is RED while files have no review position', noPosition.status === 1 && /10 of 10 changed file\(s\) have no review position/.test(noPosition.stdout) && !/^warning: .*no review position/m.test(noPosition.stdout), noPosition.stdout);
    check('verify only warns about missing positions without --require-order', explained.status === 0 && /^warning: .*10 of 10 changed file\(s\) have no review position/m.test(explained.stdout), explained.stdout);
    const beforeOrder = read('.lantern/prs/42.pr');
    const orderStray = withReason('--order', 'src/nope.ts');
    check('pr --order refuses a path the pull request does not change and leaves the record alone', orderStray.status === 2 && /not a file this pull request changes/.test(orderStray.stderr) && read('.lantern/prs/42.pr') === beforeOrder, orderStray.stderr);
    const orderTwice = withReason('--order', 'src/new.ts', '--order', 'src/new.ts');
    check('pr --order refuses a path named twice', orderTwice.status === 2 && /twice/.test(orderTwice.stderr) && read('.lantern/prs/42.pr') === beforeOrder, orderTwice.stderr);
    const orderFile = path.join(tmp, 'order.json');
    fs.writeFileSync(orderFile, JSON.stringify({ not: 'an array' }));
    const orderNotArray = withReason('--order-file', orderFile);
    check('pr --order-file refuses anything but a JSON array', orderNotArray.status === 2 && /JSON array/.test(orderNotArray.stderr), orderNotArray.stderr);
    const partialOrder = withReason('--order', 'src/new.ts', '--order', 'docs/notes#1.md');
    const orderedText = read('.lantern/prs/42.pr');
    check(
        'pr --order writes #order lines in the given order, paths encoded, after the file lines and before the reasons',
        partialOrder.status === 0 && /2\/10 with a review position/.test(partialOrder.stdout) && sameList(orderedText.split('\n').filter((line) => line.startsWith('#order ')), ['#order src/new.ts', '#order docs/notes%231.md']) && orderedText.indexOf('- src/rename-me.ts') < orderedText.indexOf('#order ') && orderedText.indexOf('#order ') < orderedText.indexOf('#reason '),
        orderedText,
    );
    const partialCheck = setupScript('prs.mjs', '.');
    check('prs.mjs accepts a partial order and prints its size', partialCheck.status === 0 && /order 2\/10/.test(partialCheck.stdout) && !/warning/.test(partialCheck.stdout), partialCheck.stdout);
    const partialVerify = sync('verify', '--base', 'main', '--require-pr');
    check('verify names the files still without a position in its warning', partialVerify.status === 0 && /8 of 10 changed file\(s\) have no review position \(.*src\/my file\.ts/.test(partialVerify.stdout), partialVerify.stdout);
    const orderKept = sync(...prArgs);
    check('pr re-run without --order keeps the order', orderKept.status === 0 && read('.lantern/prs/42.pr') === orderedText, orderKept.stderr);
    const orderFull = ['src/new.ts', 'docs/notes#1.md', 'src/renamed.ts', 'src/my file.ts', 'lib/p.ts', 'README.md', 'src/b.ts', 'src/old.ts', 'src/rename-me.ts', 'legacy/gone.ts'];
    fs.writeFileSync(orderFile, JSON.stringify(orderFull));
    const orderAll = withReason('--order-file', orderFile);
    check('pr --order-file replaces the order and covers every file', orderAll.status === 0 && sameList(read('.lantern/prs/42.pr').split('\n').filter((line) => line.startsWith('#order ')), orderFull.map((file) => `#order ${file.replace(/ /g, '%20').replace(/#/g, '%23')}`)), orderAll.stderr + read('.lantern/prs/42.pr'));
    const ordered = sync('verify', '--base', 'main', '--require-pr', '--require-order', '--require-reason');
    check('verify --require-order is GREEN once every file has a position', ordered.status === 0 && !/warning:/.test(ordered.stdout), ordered.stdout);
    const orderKeptAgain = sync(...prArgs);
    check('a re-run keeps the full order too', orderKeptAgain.status === 0 && sameList(read('.lantern/prs/42.pr').split('\n').filter((line) => line.startsWith('#order ')).map((line) => line.slice(7)), orderFull.map((file) => file.replace(/ /g, '%20').replace(/#/g, '%23'))), orderKeptAgain.stderr);
    const jsonVerify = syncJson('verify', '--base', 'main', '--require-pr');
    check('verify --json carries an empty warnings list once every file has a reason', sameList(jsonVerify.json?.warnings, []), JSON.stringify(jsonVerify.json?.warnings));

    const P = await import(pathToFileURL(path.join(setupDir, 'scripts', 'prs.mjs')).href);
    const story = {
        title: 'Admin lets a user refund orders',
        steps: [{ kind: 'actor', text: 'Admin' }, { kind: 'action', text: 'changes permissions of' }, { kind: 'subject', text: 'another user' }],
        below: [{ kind: 'actor', text: 'Another user' }, { kind: 'interaction', text: 'can now refund orders' }, { kind: 'consequence', old: 'could only view orders', new: 'can refund orders' }],
    };
    const flowFile = path.join(tmp, 'flow.json');
    const withFlow = (value) => {
        fs.writeFileSync(flowFile, JSON.stringify(value));
        return withReason('--flow-file', flowFile);
    };
    const beforeFlow = read('.lantern/prs/42.pr');
    const noFlow = sync('verify', '--base', 'main', '--require-pr', '--require-reason', '--require-order', '--require-flow');
    check('verify --require-flow is RED on a record without a flow', noFlow.status === 1 && /no flow/.test(noFlow.stdout), noFlow.stdout);
    check('verify without --require-flow stays GREEN on a record without a flow', ordered.status === 0 && !/flow/.test(ordered.stdout), ordered.stdout);
    for (const [label, value, pattern] of [
        ['an unknown kind', [{ ...story, steps: [{ kind: 'person', text: 'Admin' }] }], /unknown kind "person"/],
        ['a story with no step', [{ title: 'Empty', steps: [] }], /has no #step line/],
        ['a consequence without an old text', [{ ...story, below: [{ kind: 'consequence', new: 'x' }] }], /string "old"/],
        ['a text over 80 characters', [{ ...story, steps: [{ kind: 'actor', text: 'x'.repeat(81) }] }], /the cap is 80/],
        ['a flow that is not an array', { stories: [] }, /JSON array of stories/],
    ]) {
        const refused = withFlow(value);
        check(`pr --flow-file refuses ${label} and leaves the record alone`, refused.status === 2 && pattern.test(refused.stderr) && read('.lantern/prs/42.pr') === beforeFlow, refused.stderr);
    }
    const flowed = withFlow([story]);
    const flowedText = read('.lantern/prs/42.pr');
    check('pr --flow-file writes the story after the reasons', flowed.status === 0 && /1 flow stories/.test(flowed.stdout) && flowedText.indexOf('#reason ') < flowedText.indexOf('#story ') && flowedText.endsWith('#story Admin lets a user refund orders\n#step actor Admin\n#step action changes permissions of\n#step subject another user\n#below actor Another user\n#below interaction can now refund orders\n#below consequence could only view orders => can refund orders\n'), flowed.stderr + flowedText);
    check('the flow round-trips through prs.mjs unchanged', sameList(P.parsePr(flowedText, '.lantern/prs/42.pr').flow, [story]) && P.parsePr(flowedText, '.lantern/prs/42.pr').errors.length === 0);
    const flowCheck = setupScript('prs.mjs', '.');
    check('prs.mjs accepts the flow and prints its size', flowCheck.status === 0 && /flow 1/.test(flowCheck.stdout) && !/warning/.test(flowCheck.stdout), flowCheck.stdout);
    const flowGate = sync('verify', '--base', 'main', '--require-pr', '--require-reason', '--require-order', '--require-flow');
    check('verify --require-flow is GREEN once the record has a flow', flowGate.status === 0, flowGate.stdout);
    const flowKept = sync(...prArgs);
    check('pr re-run without --flow-file keeps the flow', flowKept.status === 0 && read('.lantern/prs/42.pr') === flowedText, flowKept.stderr);
    check('verify warns, without failing, when no step of the flow points at a changed file', flowGate.status === 0 && /^warning: .*no step of the flow points at a changed file/m.test(flowGate.stdout), flowGate.stdout);
    const refStory = { ...story, steps: [{ kind: 'actor', text: 'Admin', files: ['src/new.ts', 'src/my file.ts'] }, ...story.steps.slice(1)], below: [...story.below.slice(0, 2), { ...story.below[2], files: ['docs/notes#1.md'] }] };
    for (const [label, files, pattern] of [
        ['a file the pull request does not change', ['src/ghost.ts'], /src\/ghost\.ts, which is not a file line of this record/],
        ['the same file twice on a step', ['src/new.ts', 'src/new.ts'], /twice on one step/],
        ['seven files on a step', orderFull.slice(0, 7), /more than 6 files on one step/],
        ['files that is not an array', 'src/new.ts', /"files" is an array of changed-file paths/],
    ]) {
        const refused = withFlow([{ ...story, steps: [{ ...story.steps[0], files }, ...story.steps.slice(1)] }]);
        check(`pr --flow-file refuses ${label} and leaves the record alone`, refused.status === 2 && pattern.test(refused.stderr) && read('.lantern/prs/42.pr') === flowedText, refused.stderr);
    }
    const referenced = withFlow([refStory]);
    const referencedText = read('.lantern/prs/42.pr');
    check('pr --flow-file writes #file lines right under their step, paths encoded', referenced.status === 0 && /1 flow stories \(2 steps with files\)/.test(referenced.stdout) && referencedText.includes('#step actor Admin\n#file src/new.ts\n#file src/my%20file.ts\n#step action') && referencedText.includes('#below consequence could only view orders => can refund orders\n#file docs/notes%231.md\n'), referenced.stderr + referencedText);
    const parsedRefs = P.parsePr(referencedText, '.lantern/prs/42.pr');
    check('the references round-trip through prs.mjs as decoded paths', parsedRefs.errors.length === 0 && sameList(parsedRefs.flow, [refStory]), JSON.stringify(parsedRefs.errors));
    const refGate = sync('verify', '--base', 'main', '--require-pr', '--require-reason', '--require-order', '--require-flow');
    check('verify stops warning once a step points at a file', refGate.status === 0 && !/points at a changed file/.test(refGate.stdout), refGate.stdout);
    const refKept = sync(...prArgs);
    check('pr re-run without --flow-file keeps the references', refKept.status === 0 && read('.lantern/prs/42.pr') === referencedText, refKept.stderr);
    const flowCleared = withFlow([]);
    check('pr --flow-file with an empty array clears the flow', flowCleared.status === 0 && read('.lantern/prs/42.pr') === beforeFlow, flowCleared.stderr);
    write('.lantern/prs/42.pr', `${beforeFlow}#story broken\n#step person Admin\n`);
    const badFlowGate = sync('verify', '--base', 'main', '--require-pr');
    check('verify is RED on a record with a malformed flow, without --require-flow', badFlowGate.status === 1 && /pr record: .*#step unknown kind "person"/.test(badFlowGate.stdout), badFlowGate.stdout);
    write('.lantern/prs/42.pr', beforeFlow);

    const goodReason = read('.lantern/prs/42.pr');
    for (const [label, bad, pattern] of [
        ['a #reason for a path the record does not list', `${goodReason}#reason src/ghost.ts nope\n`, /not a file line/],
        ['a duplicate #reason', `${goodReason}#reason src/new.ts again\n`, /duplicate #reason/],
        ['a #reason over the cap', goodReason.replace(/^#reason src\/new\.ts .*$/m, `#reason src/new.ts ${'z'.repeat(161)}`), /cap is 160/],
        ['an #order for a path the record does not list', `${goodReason}#order src/ghost.ts\n`, /#order names src\/ghost\.ts, which is not a file line/],
        ['a duplicate #order', `${goodReason}#order src/new.ts\n#order src/new.ts\n`, /duplicate #order/],
        ['an #order with no path', `${goodReason}#order\n`, /#order must be "#order <path>"/],
        ['a #reason with no reason', goodReason.replace(/^#reason src\/new\.ts .*$/m, '#reason src/new.ts'), /reason is empty/],
    ]) {
        write('.lantern/prs/42.pr', bad);
        const refused = setupScript('prs.mjs', '.');
        check(`prs.mjs rejects ${label}`, refused.status === 1 && pattern.test(refused.stdout), refused.stdout);
    }
    write('.lantern/prs/42.pr', expected);
    fs.rmSync(path.join(repo, 'src/b.ts'));
    const dirtyFinish = syncJson('finish', '--base', 'main', '--model', MODEL);
    check('finish warns about uncommitted source and still treats a deleted mapped file as removed', /uncommitted/.test(sync('finish', '--base', 'main').stdout) && dirtyFinish.json?.uncommittedSource.includes('src/b.ts') && (dirtyFinish.json?.workList ?? []).some((w) => w.path === 'src/a.ts' && /src\/b\.ts.*removed or renamed/.test(w.reasons.join(';'))), JSON.stringify(dirtyFinish.json?.workList));
    check('verify goes RED on uncommitted source changes', /uncommitted/.test(sync('verify', '--base', 'main').stdout) && sync('verify', '--base', 'main').status === 1);
    git('checkout', '--', '.lantern', 'src/b.ts');
    check('a later source commit leaves #head behind: verify --require-pr goes RED', (() => {
        write('README.md', '# project\n\nchanged again\n');
        git('add', 'README.md');
        git('commit', '-q', '-m', 'docs: touch readme');
        const result = sync('verify', '--base', 'main', '--require-pr');
        git('reset', '-q', '--hard', 'HEAD~1');
        return result.status === 1 && /#head is/.test(result.stdout);
    })());

    const goodPr = read('.lantern/prs/42.pr');
    write('.lantern/prs/42.pr', goodPr.replace(/^#url .*\n/m, ''));
    const badPr = sync('verify', '--base', 'main');
    check('verify goes RED on a malformed PR record', badPr.status === 1 && /pr record:/.test(badPr.stdout), badPr.stdout);
    write('.lantern/prs/42.pr', goodPr);

    const HEADER = 'lantern-prs-dismissed 1';
    write('.lantern/prs/9.pr', goodPr.replace('# 42', '# 9').replace(/^#branch .*$/m, '#branch other/nine'));
    const refused0 = sync('pr', '9', '--url', 'https://x.test/9', '--title', 't', '--base', 'main', '--branch', 'other/nine');
    check('pr is not refused for an id that is not dismissed', refused0.status === 0, refused0.stderr);
    const dismissed1 = sync('dismiss', '42', '9');
    check('dismiss deletes the records and creates the file with its header, ids sorted', dismissed1.status === 0 && !exists('.lantern/prs/42.pr') && !exists('.lantern/prs/9.pr') && read('.lantern/prs/dismissed') === `${HEADER}\n9\n42\n`, dismissed1.stdout + dismissed1.stderr + (exists('.lantern/prs/dismissed') ? read('.lantern/prs/dismissed') : ''));
    const snapshot = read('.lantern/prs/dismissed');
    const dismissed2 = sync('dismiss', '42', '9');
    check('dismiss is idempotent: a second run changes nothing', dismissed2.status === 0 && read('.lantern/prs/dismissed') === snapshot, dismissed2.stdout);
    const dismissed3 = syncJson('dismiss', '7', '42', '100');
    check('dismiss inserts new ids unique and numerically sorted', dismissed3.status === 0 && read('.lantern/prs/dismissed') === `${HEADER}\n7\n9\n42\n100\n` && sameList(dismissed3.json?.newlyDismissed, ['7', '100']), dismissed3.stdout);
    const badId = sync('dismiss', '12', 'x1');
    check('dismiss with an invalid id exits 2 naming it and changes nothing', badId.status === 2 && /invalid pull request id "x1"/.test(badId.stderr) && read('.lantern/prs/dismissed') === `${HEADER}\n7\n9\n42\n100\n`, badId.stderr);
    const noId = sync('dismiss');
    check('dismiss without an id exits 2', noId.status === 2 && /needs at least one <id>/.test(noId.stderr), noId.stderr);
    const prRefused = sync('pr', '42', '--url', 'https://x.test/42', '--title', 't', '--base', 'main', '--branch', 'feat/a');
    check('pr refuses to write a record for a dismissed id (exit 1)', prRefused.status === 1 && /pull request #42 is dismissed/.test(prRefused.stderr) && !exists('.lantern/prs/42.pr'), prRefused.stderr);
    const strayOk = setupScript('prs.mjs', '.');
    check('prs.mjs accepts the dismissed file and does not report it as a stray file', strayOk.status === 0 && !/not a \.pr record/.test(strayOk.stdout), strayOk.stdout);
    const verifyOk = sync('verify', '--base', 'main');
    check('verify stays GREEN with a valid dismissed file', verifyOk.status === 0, verifyOk.stdout);
    const statusCount = sync('status');
    const statusJson = syncJson('status');
    check('status shows the dismissed count', statusCount.status === 0 && /dismissed: 4/.test(statusCount.stdout) && sameList(statusJson.json?.dismissed, ['7', '9', '42', '100']), statusCount.stdout);
    write('.lantern/prs/42.pr', goodPr);
    const keptWarn = setupScript('prs.mjs', '.');
    check('a record kept for a dismissed id is a warning, not an error', keptWarn.status === 0 && /record kept for a dismissed PR/.test(keptWarn.stdout), keptWarn.stdout);
    fs.unlinkSync(path.join(repo, '.lantern/prs/42.pr'));
    const goodDismissed = read('.lantern/prs/dismissed');
    for (const [label, text, pattern] of [
        ['a missing header', '7\n9\n', /first line must be/],
        ['a non-digit id', `${HEADER}\n7\nabc\n`, /expected a pull request id/],
        ['a duplicate id', `${HEADER}\n7\n7\n`, /duplicate id 7/],
        ['an unknown line', `${HEADER}\n7\nmerged: 9\n`, /expected a pull request id/],
    ]) {
        write('.lantern/prs/dismissed', text);
        const red = sync('verify', '--base', 'main');
        const statusRed = sync('status');
        check(`verify goes RED and status flags ${label} in dismissed`, red.status === 1 && pattern.test(red.stdout) && pattern.test(statusRed.stdout), red.stdout + statusRed.stdout);
    }
    write('.lantern/prs/dismissed', `${HEADER}\n9\n7\n`);
    const unsorted = setupScript('prs.mjs', '.');
    check('an unsorted dismissed file is only a warning', unsorted.status === 0 && /out of order/.test(unsorted.stdout), unsorted.stdout);
    write('.lantern/prs/dismissed', goodDismissed);
    const repaired = sync('dismiss', '7');
    check('dismiss still works after the file is repaired', repaired.status === 0 && read('.lantern/prs/dismissed') === goodDismissed, repaired.stderr);
    fs.unlinkSync(path.join(repo, '.lantern/prs/dismissed'));
    write('.lantern/prs/42.pr', goodPr);

    write('src/b.ts', 'export function helperB() {\n    return 2;\n}\nexport const extra = 2;\n');
    git('add', 'src/b.ts');
    git('commit', '-q', '-m', 'fix: change b without the map');
    const stale = sync('verify', '--base', 'main');
    check('verify goes RED again when a mapped file changes without a re-map', stale.status === 1 && /src\/b\.ts: changed in this branch and its record is stale/.test(stale.stdout), stale.stdout);
    git('reset', '-q', '--hard', 'HEAD~1');

    const mainSha = git('rev-parse', 'main');
    git('update-ref', 'refs/remotes/origin/main', mainSha);
    git('branch', '-q', '-D', 'main');
    const viaOrigin = syncJson('status', '--base', 'main');
    check('a base that exists only as origin/<base> resolves to it', viaOrigin.status === 0 && viaOrigin.json?.changeSet.base === 'origin/main' && viaOrigin.json?.changeSet.added.length === 4, viaOrigin.stderr);
    git('branch', 'main', mainSha);

    const noSibling =path.join(tmp, 'lonely', 'lantern-sync');
    fs.mkdirSync(path.dirname(noSibling), { recursive: true });
    fs.cpSync(skillDir, noSibling, { recursive: true });
    const lonely = run(process.execPath, [path.join(noSibling, 'scripts', 'sync.mjs'), 'status'], repo);
    check('without a linked lantern-setup it fails with a clear message', lonely.status === 2 && /lantern-setup is not linked next to lantern-sync/.test(lonely.stderr) && !/at .*\.mjs:\d+/.test(lonely.stderr), lonely.stderr);

    const linked = path.join(tmp, 'linked');
    fs.mkdirSync(linked);
    fs.symlinkSync(skillDir, path.join(linked, 'lantern-sync'));
    fs.symlinkSync(setupDir, path.join(linked, 'lantern-setup'));
    const viaLink = run(process.execPath, [path.join(linked, 'lantern-sync', 'scripts', 'sync.mjs'), 'status', '--base', 'main'], repo);
    check('linked side by side as symlinks it resolves its sibling and runs', viaLink.status === 0 && /lantern-sync status/.test(viaLink.stdout), viaLink.stderr);

    markdownNodes();
    oldMapMeetsMarkdown();
    mapOnlyAndStacked();
    recordForAnOpenPr();
    missingReasonsAndExemptFiles();
    vocabularyOnVerify();
    strayAfterSeed();
} finally {
    if (process.env.SELFTEST_KEEP) console.log(`kept ${tmp}`);
    else fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? `\nall ${count} assertions passed` : `\n${failures} of ${count} assertions FAILED`);
process.exit(failures === 0 ? 0 : 1);

#!/usr/bin/env node
//
// preflight.mjs — assert everything a delegate run needs, before dispatch.
//
//   node preflight.mjs --target <branch> [--skills a,b,c] [--repo-dir <path>] [--no-api] \
//                      [--remote origin] [--init] [--delivery pr|push|local]
//
// --delivery is the user's recorded choice (preferences.mjs): push leaves the host skill and its
// credentials out, local checks like --local-only. Default pr.
//
// The host is read from the remote's URL, never asked: bitbucket.org, or github.com (an SSH
// alias is resolved with `ssh -G`). Any other host, or no remote, fails. Then, for that host only:
// its Lantern skill (lantern-bitbucket or lantern-github) must be in the registry and runs its
// `check`: credentials resolve through the environment or the running Lantern (Bitbucket also: the
// token carries write:pullrequest; GitHub: the token authenticates and sees the repo); this script
// reads no token itself. The PR target exists on the remote; the git identity commits
// will carry (a declared GIT_COMMIT_NAME / GIT_COMMIT_EMAIL that git config contradicts fails, an
// undeclared one warns); every skill the run needs is in the registry the delegate will inherit.
// Every failure is printed, not just the first, and the exit code is non-zero if any failed.
//
// Required skills: the bundled ones (bundled-skills.mjs) must be
// installed, plus the orchestrator-slot skills of the extensions config (the user's
// ~/.claude/lantern-extensions.json plus the project's .claude/lantern-extensions.json, see
// extensions.mjs) and any named by --skills. A configured extra (any slot) that does not resolve is
// skipped with a warning; a damaged config file is a warning and counts as empty. --home <dir>
// replaces the home folder (the config and ~/.claude/skills).
//
// Local mode: a git repository with no remote at all passes without host, credentials or a target
// branch on a remote; the delegate commits on its own branch and nothing is pushed. A folder that is
// not a git repository (or has no commit) fails, unless --init is given: that runs init-local.mjs
// first (git init -b main, a minimal .gitignore, one commit) and then checks it as local mode.
// --init is the only way this script writes to the project.
//
// --repo-dir is the repository the work is about (default: the current directory). Every git
// check — the remote, the target branch, the identity, the main checkout's .ai/.env — runs there,
// so a session in one repo can dispatch work into another. The skill registry is always the
// session's provider-native project and user skill roots (--provider claude|codex, default claude).
// --no-api skips the Bitbucket/GitHub API calls (token scope, repo visibility, the SSH account
// lookup). Credentials are still checked for being present. Used by the tests; a real dispatch
// runs without it, since the scope check is what catches a read-only token.
// Permissions (a failure when any is missing): the commands a delegate runs and the Edit and Write rules
// for the files its skills tell it to write (EDIT_TARGETS), all from permissions.mjs, are
// looked for in the allow lists of <cwd>/.claude/settings*.json, <repo-dir>/.claude/settings*.json
// and ~/.claude/settings.json; what is missing is printed with a ready settings.json snippet. The
// last line, `limits`, states what an unattended delegate cannot do (interactive logins, a local
// backend, looking at an app) so the dispatch line can say it.
// RTK (optional, read only, never a failure): rtk-detect.mjs prints `ok rtk: <path> <version> <edition>` or
// `note rtk: not installed (optional)`, plus `WARN rtk-hook` when an `rtk hook claude` entry is set in
// ~/.claude/settings.json or the project's .claude/settings*.json. Nothing is installed or written.
// It looks in the known install folders and on PATH only, never in a login shell, so no shell startup file runs.
// LANTERN_RTK_DETECT=off skips the whole RTK check (no line, no probe).
// --skills takes the names the brief mentions; the ones every delegate run needs are always checked.

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { commitIdentity, findMismatches, formatReport, remoteAccount, resolveProfile } from './github/identity.mjs';
import { EMAIL_SOURCE } from './lantern-account.mjs';
import { git as plainGit } from './git-env.mjs';
import { BUNDLED_SKILLS, offEverywhere } from './bundled-skills.mjs';
import { configuredExtras, resolvedExtras, skillResolves } from './extension-skills.mjs';
import { EXTENSION_SLOT, projectRootOf } from './extensions.mjs';
import { classifyRemote, listRemotes, pickRemote } from './host.mjs';
import { HOST_SKILL, HOST_SKILL_NAMES, hostScript, runHostSkill, skillRoots } from './host-skill.mjs';
import { hasCommit, initLocal, isWorkTree } from './init-local.mjs';
import { message } from './messages.mjs';
import { DELIVERY } from './preferences.mjs';
import { PLAN_SKILLS } from './required-skills.mjs';
import { resolveSkillLinker } from './skill-linker.mjs';
import { LIMITS, brokenSettings, missingPermissions, requiredAllow, settingsFiles, settingsSnippet } from './permissions.mjs';
import { describeRtk, describeRtkHook, detectRtk, rtkDetectionDisabled } from './rtk-detect.mjs';

const sessionCwd = process.cwd();
const NO_VALUE_FLAGS = new Set(['no-api', 'init', 'local-only']);
const CODEX_ALWAYS_SKILLS = ['lantern-delegate', 'lantern-sync', 'lantern-setup'];

const SOURCE_LABEL = Object.freeze({ environment: 'preflight.source.environment', lantern: 'preflight.source.lantern', socket: 'preflight.source.socket' });

let detectedHost = null;

const results = [];
const ok = (check, detail) => results.push({ check, detail });
const fail = (check, detail) => results.push({ check, detail, failed: true });
const warn = (check, detail) => results.push({ check, detail, warning: true });

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i]?.replace(/^--/, '');
        if (!key) {
            console.error(`Bad argument near "${argv[i]}"`);
            process.exit(2);
        }
        if (NO_VALUE_FLAGS.has(key)) {
            out[key] = true;
            continue;
        }
        if (argv[i + 1] === undefined) {
            console.error(`Bad argument near "${argv[i]}"`);
            process.exit(2);
        }
        out[key] = argv[++i];
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.target) {
    console.error('Missing --target: the branch the pull request will be opened against.');
    process.exit(2);
}

const home = resolve(args.home || homedir());
const delivery = args.delivery ?? DELIVERY.pr;
if (!Object.values(DELIVERY).includes(delivery)) {
    console.error(message('preflight.badDelivery', { value: delivery, values: Object.values(DELIVERY).join(', ') }));
    process.exit(2);
}

const repoDir = resolve(args['repo-dir'] || sessionCwd);
if (!statSync(repoDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`--repo-dir ${repoDir} is not a directory.`);
    process.exit(2);
}
// The credential and identity helpers run plain `git` in the process's directory, so they follow
// the repo the work is about. Preflight's own checks name it with -C as well.
process.chdir(repoDir);
const git = (...gitArgs) => plainGit('-C', repoDir, ...gitArgs);

function findRemote() {
    const remotes = listRemotes(repoDir);
    const name = args.remote || (remotes.some((r) => r.name === 'origin') ? 'origin' : undefined);
    const picked = pickRemote(remotes, { name });
    if (picked.error) return { error: `${picked.error} Pass --remote.` };
    return picked.remote;
}

const ACCESS_REPORT = Object.freeze({
    bitbucket: (info, source) => [
        ['credentials', message('preflight.bitbucketCredentials', { source })],
        ['scope', info.repository ? message('preflight.scopeGranted', { repository: info.repository }) : message('preflight.scopeSkipped')],
    ],
    github: (info, source) => [
        ['credentials', info.login ? message('preflight.githubCredentials', { source, login: info.login }) : message('preflight.githubCredentialsOffline', { source })],
        ...(info.repository ? [['repo', message('preflight.repoVisible', { repository: info.repository })]] : []),
    ],
});

function parseCheck(host, check) {
    try {
        return JSON.parse(check.stdout);
    } catch {
        fail('credentials', message('preflight.unreadableCheck', { skill: HOST_SKILL[host].skill, text: check.stdout.trim().slice(0, 200) }));
        return null;
    }
}

function checkHostAccess(host, remote) {
    const flags = args['no-api'] ? ['--offline'] : [];
    const check = runHostSkill(host, ['check', '--json', '--remote', remote.name, ...flags], { cwd: repoDir, roots: skillRoots({ cwd: sessionCwd }) });
    if (check.status !== 0) {
        fail('credentials', check.stderr.trim());
        return undefined;
    }
    const info = parseCheck(host, check);
    if (!info) return undefined;
    for (const [name, detail] of ACCESS_REPORT[host](info, message(SOURCE_LABEL[info.source]))) ok(name, detail);
    return info.login;
}

function checkTarget(remoteName) {
    let refs;
    try {
        refs = git('ls-remote', '--heads', remoteName, `refs/heads/${args.target}`);
    } catch (e) {
        fail('target', `git -C ${repoDir} ls-remote --heads ${remoteName} refs/heads/${args.target} failed: ${e.message}`);
        return;
    }
    if (!refs) {
        fail(
            'target',
            `${remoteName} of ${repoDir} has no branch "${args.target}" — the pull request would be refused with ` +
                'a destination-branch error. Push it, or pick a branch that exists.',
        );
        return;
    }
    ok('target', `${args.target} exists on ${remoteName} of ${repoDir}`);
}

const IDENTITY_OK = Object.freeze({
    [EMAIL_SOURCE.profile]: 'preflight.identityFrom.profile',
    [EMAIL_SOURCE.env]: 'preflight.identityFrom.env',
});

async function checkIdentity(account, login, host) {
    const { profile, emailSource } = await resolveProfile({ host, cwd: repoDir });
    const identity = commitIdentity();
    console.log(formatReport({ profile, identity, account, tokenLogin: login, authors: [], emailSource }));
    console.log('');
    const enforced = emailSource === EMAIL_SOURCE.profile ? { name: profile.name } : profile;
    const { problems } = findMismatches({ profile: enforced?.name || enforced?.email ? enforced : null, identity, authors: [], sshLogin: account.sshLogin, tokenLogin: login });
    const author = `${profile?.name ?? identity.name.value ?? '(unset)'} <${profile?.email ?? identity.email.value ?? 'unset'}>`;
    if (problems.length) {
        fail('identity', message('preflight.identityMismatch', { problems: problems.join('; ') }));
    } else if (emailSource === EMAIL_SOURCE.none) {
        warn('identity', message('preflight.identityNoEmail', { author: `${identity.name.value ?? '(unset)'} <${identity.email.value ?? 'unset'}>` }));
    } else {
        ok('identity', message(IDENTITY_OK[emailSource], { author }));
    }
}

function provider() {
    const value = args.provider || 'claude';
    if (value !== 'claude' && value !== 'codex') {
        console.error(`Unsupported --provider ${value}; expected claude or codex.`);
        process.exit(2);
    }
    return value;
}

const selectedProvider = provider();

function registryRoots() {
    if (selectedProvider === 'codex') {
        const codexHome = process.env.CODEX_HOME || join(home, '.codex');
        return [join(sessionCwd, '.agents', 'skills'), join(home, '.agents', 'skills'), join(codexHome, 'skills')];
    }
    return [join(sessionCwd, '.claude', 'skills'), join(home, '.claude', 'skills')];
}

const skillLinker = resolveSkillLinker({ home });

function checkSkillLinker() {
    if (skillLinker.error) {
        results.push({ check: 'skill-linker', detail: message('preflight.skillLinkerUnusable', { reason: skillLinker.error }), note: true });
        return;
    }
    if (skillLinker.path) results.push({ check: 'skill-linker', detail: message('preflight.skillLinkerNote', skillLinker), ok: true });
}

function linkHint(names) {
    return `Link the others yourself: ${names.map((name) => `\`${skillLinker.path} . --skill ${name}\``).join(', ')}.`;
}

function configuredOrchestratorSkills(roots) {
    const sessionConfig = configuredExtras(home, projectRootOf(sessionCwd));
    const config = configuredExtras(home, projectRootOf(repoDir));
    const orchestrator = resolvedExtras(EXTENSION_SLOT.orchestrator, sessionConfig.slots[EXTENSION_SLOT.orchestrator], roots);
    const delegate = resolvedExtras(EXTENSION_SLOT.delegate, config.slots[EXTENSION_SLOT.delegate], roots);
    const reviewer = resolvedExtras(EXTENSION_SLOT.reviewer, config.slots[EXTENSION_SLOT.reviewer], roots);
    const configWarnings = [...new Set([...sessionConfig.warnings, ...config.warnings])];
    for (const text of [...configWarnings, ...orchestrator.warnings, ...delegate.warnings, ...reviewer.warnings]) warn('extensions', text);
    if (delegate.present.length) ok('extra-skills', message('preflight.extraSkillsLine', { names: delegate.present.join(', ') }));
    if (reviewer.present.length) ok('extra-skills', message('preflight.reviewerExtraSkillsLine', { names: reviewer.present.join(', ') }));
    for (const slot of Object.values(EXTENSION_SLOT)) if (config.off[slot].length) ok('skills-off', message('preflight.switchedOffSkillsLine', { slot, names: config.off[slot].join(', ') }));
    return orchestrator.present;
}

function checkSkills() {
    const named = [
        ...(args.skills || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ...(args.plan ? PLAN_SKILLS : []),
    ];
    const hostSkills = detectedHost ? [HOST_SKILL[detectedHost].skill] : [];
    const notInstalled = offEverywhere(configuredExtras(home).off);
    const bundledForRun = BUNDLED_SKILLS.filter((name) => !HOST_SKILL_NAMES.includes(name) && !notInstalled.includes(name));
    const roots = registryRoots();
    const orchestratorSkills = configuredOrchestratorSkills(roots);
    const always = selectedProvider === 'codex' ? [...CODEX_ALWAYS_SKILLS, ...hostSkills, ...orchestratorSkills] : [...bundledForRun, ...hostSkills, ...orchestratorSkills];
    const perRun = [...new Set(named)].filter((name) => !always.includes(name));
    const wanted = [...always, ...perRun];
    const hostNote = hostSkills.length ? ` | host: ${hostSkills.join(', ')}` : '';
    const extrasNote = orchestratorSkills.length ? ` | orchestrator extras: ${orchestratorSkills.join(', ')}` : '';
    const checked =
        (selectedProvider === 'codex' ? `always (codex): ${always.join(', ')}` : `bundled: ${bundledForRun.join(', ')}${hostNote}${extrasNote}`) +
        (perRun.length ? ` | this run: ${perRun.join(', ')}` : ' | this run: none beyond those');
    const missing = wanted.filter((name) => !skillResolves(name, roots));
    if (missing.length) {
        const isBundled = (name) => BUNDLED_SKILLS.includes(name) || PLAN_SKILLS.includes(name);
        const bundled = missing.filter(isBundled);
        const others = missing.filter((name) => !isBundled(name));
        const fixes = [];
        if (bundled.length) fixes.push(`bundled with Lantern, install them with \`pnpm run install-skills -- <project>\` in the Lantern repo: ${bundled.join(', ')}.`);
        if (others.length && skillLinker.path) fixes.push(linkHint(others));
        fail(
            'skills',
            `not in the registry the delegate inherits: ${missing.join(', ')}. A delegate errors hard on an unlinked skill. ${fixes.join(' ')} ` +
                `Checked ${checked}. Looked in: ${roots.join(', ')}`,
        );
        return;
    }
    ok('skills', `${wanted.length} resolve — ${checked}`);
}

const PLAN_MODULES = ['plan-git.mjs', 'plan-handoff.mjs', 'plan-io.mjs', 'plan-messages.mjs', 'plan-run.mjs'];

const importPlan = (dir, name) => import(pathToFileURL(join(dir, 'scripts', name)).href);

function gitOrNull(...gitArgs) {
    try {
        return git(...gitArgs);
    } catch {
        return null;
    }
}

async function locatePlanSkill(plan) {
    const roots = registryRoots();
    const dir = roots.map((root) => join(root, 'lantern-plan')).find((candidate) => existsSync(join(candidate, 'scripts', 'plan.mjs')));
    if (!dir) return `--plan ${plan.slug} needs lantern-plan, which is not in ${roots.join(', ')}. Install it with \`pnpm run install-skills -- <project>\` in the Lantern repo.`;
    try {
        const [remote, handoff, io, messages, run] = await Promise.all(PLAN_MODULES.map((name) => importPlan(dir, name)));
        Object.assign(plan, { script: join(dir, 'scripts', 'plan.mjs'), remote, handoff, io, messages, run });
    } catch (error) {
        return `--plan ${plan.slug} needs lantern-plan, which could not be loaded from ${dir}: ${error.message}`;
    }
    return null;
}

function checkHandoff(plan) {
    const { say, LINE } = plan.messages;
    const { report, failure } = plan.run.runPlanJson(plan.script, ['handoff', plan.slug, '--root', repoDir]);
    if (failure) return say(LINE.PREFLIGHT_HANDOFF_FAILED, { slug: plan.slug, reason: failure });
    if (!report.ok) return say(LINE.PREFLIGHT_NOT_READY, { slug: plan.slug, reasons: report.reasons.join('; ') });
    plan.report = report;
    return null;
}

function checkPlanOnBase(plan) {
    const { say, LINE, NOUN } = plan.messages;
    const rel = plan.io.planRel(plan.slug);
    const hasRemote = gitOrNull('rev-parse', '--verify', '--quiet', `${plan.remote.REMOTE_PREFIX}${args.target}`) !== null;
    const ref = hasRemote ? `${plan.remote.REMOTE_NAME}/${args.target}` : args.target;
    const onBase = gitOrNull('rev-parse', '--verify', '--quiet', `${ref}:${rel}`);
    if (onBase !== null && onBase === gitOrNull('hash-object', join(repoDir, rel))) return null;
    return say(LINE.PREFLIGHT_NOT_ON_BASE, { slug: plan.slug, rel, what: say(onBase === null ? NOUN.PREFLIGHT_ABSENT : NOUN.PREFLIGHT_DIFFERS), ref, target: args.target });
}

const PLAN_CHECKS = [locatePlanSkill, checkHandoff, checkPlanOnBase];

async function checkPlan() {
    if (!args.plan) return;
    const plan = { slug: args.plan };
    for (const check of PLAN_CHECKS) {
        const problem = await check(plan);
        if (problem) return fail('plan', problem);
    }
    const { say, LINE } = plan.messages;
    ok('plan', say(LINE.PREFLIGHT_OK, { slug: plan.slug, next: plan.handoff.nextSummary(plan.report) }));
}

function checkHostSkill() {
    if (!detectedHost) return;
    const { skill } = HOST_SKILL[detectedHost];
    const roots = skillRoots({ cwd: sessionCwd });
    const script = hostScript(detectedHost, roots);
    if (script) ok('host-skill', message('preflight.hostSkillOk', { skill, script }));
    else fail('host-skill', message('hostSkill.missing', { skill, roots: roots.join(', ') }));
}

function checkPermissions() {
    if (selectedProvider === 'codex') return;
    const files = settingsFiles([sessionCwd, repoDir]);
    const skillRoots = registryRoots();
    const missing = missingPermissions(files, requiredAllow(skillRoots, skillLinker.path));
    if (!missing.length) {
        ok('permissions', 'the git and skill-script commands a delegate runs, and the Edit and Write rules for the files its skills tell it to write, are allowed in settings');
        return;
    }
    const broken = brokenSettings(files);
    const brokenNote = broken.length
        ? `${broken.map(({ file, problem }) => `${file}: ${problem}`).join('; ')}. Lantern leaves such a file untouched and its rules are ignored, so fix it by hand; that is why the rules stay missing. `
        : '';
    fail(
        'permissions',
        brokenNote +
            `${missing.length} command(s) or file edit(s) a delegate runs are not allowed in ${files.join(', ')}, so an unattended run would be denied them: ${missing.join(' ')}. ` +
            `Open the project in Lantern, or run \`pnpm run install-skills -- ${sessionCwd}\` in the Lantern repo: either writes them into ${join(sessionCwd, '.claude', 'settings.local.json')}. ` +
            'By hand, add this to that file (or run `node permissions.mjs` beside this script to print it):\n' +
            `${settingsSnippet({ skillRoots, skillLinker: skillLinker.path })}\n` +
            'It allows pushes only to feat/, fix/, docs/ and chore/ branches, denies a push with anything after the branch, and any force or delete push (patterns, not a guarantee: protocol.md still forbids them), and allows no checkout, merge, clean or stash. A delegate runs git from its worktree root, never `git -C <dir>` or `cd <dir> && git`.',
    );
}

async function checkRtk() {
    let status;
    try {
        status = await detectRtk({ projectDirs: [...new Set([sessionCwd, repoDir])], loginShell: false });
    } catch (e) {
        results.push({ check: 'rtk', detail: `check failed (${e.message}), ignored (optional)`, note: true });
        return;
    }
    const line = describeRtk(status);
    results.push(line.level === 'ok' ? { check: line.check, detail: line.detail } : { check: line.check, detail: line.detail, note: true });
    const hook = describeRtkHook(status);
    if (hook) warn(hook.check, hook.detail);
}

function checkLocalTarget() {
    try {
        const sha = git('rev-parse', '--verify', `${args.target}^{commit}`).trim();
        ok('target', `${args.target} resolves locally in ${repoDir} at ${sha.slice(0, 12)}`);
    } catch {
        fail('target', `${repoDir} has no local commit for "${args.target}"`);
    }
}

async function checkLocalMode() {
    if (!hasCommit(repoDir)) {
        fail('commit', `${repoDir} has no commit yet, so a delegate worktree has nothing to fork from. Commit once, or pass --init.`);
        return;
    }
    ok('host', 'local mode: no remote. The delegate commits on its own branch; nothing is pushed and no pull request is opened.');
    const branch = git('branch', '--show-current');
    if (git('branch', '--list', args.target)) ok('target', `${args.target} is a local branch of ${repoDir} (local mode: no remote check)`);
    else warn('target', `no local branch "${args.target}" in ${repoDir}${branch ? ` (checked out: ${branch})` : ''}; the delegate needs an existing base to fork from.`);
    return checkIdentity({ via: 'local' }, undefined);
}

async function checkRemoteMode(found) {
    const kind = found.error ? found : classifyRemote(found.url, undefined, found.rawUrl);
    if (kind.error) {
        fail('host', kind.error);
        return;
    }
    ok('host', `${kind.host} (from remote ${found.name}: ${found.url})`);
    let login;
    if (delivery === DELIVERY.push) results.push({ check: 'credentials', detail: message('preflight.pushNoPullRequest'), note: true });
    else {
        detectedHost = kind.host;
        login = checkHostAccess(kind.host, found);
    }
    checkTarget(found.name);
    await checkIdentity(args['no-api'] ? { via: 'https', host: kind.parsed.host } : remoteAccount(found.url), login, kind.host);
}

function prepareRepository() {
    if (isWorkTree(repoDir) && hasCommit(repoDir)) return true;
    if (!args.init) {
        fail('repo', `${repoDir} is ${isWorkTree(repoDir) ? 'a git repository with no commit' : 'not a git repository'}. Pass --init to set it up (git init -b main, a minimal .gitignore, one commit), or run init-local.mjs.`);
        return false;
    }
    const result = initLocal(repoDir);
    if (!result.ok) {
        fail('repo', result.reason);
        return false;
    }
    ok('repo', result.message);
    return true;
}

if (prepareRepository()) {
    const remotes = listRemotes(repoDir);
    if (args['local-only'] || delivery === DELIVERY.local) {
        checkLocalTarget();
        ok('publication', 'local-only; remote, network, credentials, identity, push, and pull-request capability not checked');
    } else if (!remotes.length && !args.remote) await checkLocalMode();
    else await checkRemoteMode(findRemote());
}
checkSkillLinker();
checkSkills();
await checkPlan();
checkHostSkill();
checkPermissions();
if (!rtkDetectionDisabled()) await checkRtk();
results.push({ check: 'limits', detail: LIMITS, note: true });

for (const r of results) {
    console.log(`${r.failed ? 'FAIL' : r.warning ? 'WARN' : r.note ? 'note' : 'ok  '} ${r.check}: ${r.detail}`);
}

const failed = results.filter((r) => r.failed);
if (failed.length) {
    console.error(`\n${failed.length} preflight check(s) failed: ${failed.map((r) => r.check).join(', ')}`);
    process.exit(1);
}
console.log('\npreflight green');

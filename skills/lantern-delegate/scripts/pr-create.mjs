#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { commitIdentity, findMismatches, formatReport, rangeAuthors, remoteAccount, resolveProfile } from './github/identity.mjs';
import { git } from './git-env.mjs';
import { HOST_SKILL, runHostSkill } from './host-skill.mjs';
import { classifyRemote, listRemotes, pickRemote } from './host.mjs';
import { message } from './messages.mjs';
import { PUSH_BRANCH_TYPES } from './permissions.mjs';

const FLAGS = new Set(['dry-run']);
const OWNER_FLAGS = ['workspace', 'owner'];
const BRANCH_NAME = new RegExp(`^(?:${PUSH_BRANCH_TYPES.join('|')})/[A-Za-z0-9][A-Za-z0-9._-]*$`);
const URL_IN_TEXT = /https?:\/\/\S+/g;
const DEFAULT_BRANCH = /ref: refs\/heads\/(\S+)\s+HEAD/;

class Stop extends Error {}

const stop = (text) => {
    throw new Stop(text);
};

export function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i].replace(/^--/, '');
        if (FLAGS.has(key)) {
            out[key] = true;
            continue;
        }
        if (argv[i + 1] === undefined) stop(message('prCreate.badArgument', { argument: argv[i] }));
        i += 1;
        out[key] = argv[i];
    }
    return out;
}

export function chooseHost(args, remotes, resolveHostname) {
    const owner = OWNER_FLAGS.map((flag) => args[flag]).find(Boolean);
    const picked = pickRemote(remotes, { name: args.remote, owner, repo: args.repo });
    if (picked.error) stop(picked.error);
    const kind = classifyRemote(picked.remote.url, resolveHostname, picked.remote.rawUrl);
    if (kind.error) stop(kind.error);
    return { host: kind.host, remote: picked.remote };
}

export function checkBranch(branch) {
    if (!branch) stop(message('prCreate.detachedHead'));
    if (!BRANCH_NAME.test(branch)) stop(message('prCreate.badBranch', { branch, types: PUSH_BRANCH_TYPES.map((type) => `${type}/`).join(', ') }));
}

function gitOrStop(...args) {
    try {
        return git(...args);
    } catch (error) {
        return stop(message('prCreate.gitFailed', { command: error.command ?? 'git', said: error.message }));
    }
}

function defaultTarget(remoteName) {
    const target = DEFAULT_BRANCH.exec(gitOrStop('ls-remote', '--symref', remoteName, 'HEAD'))?.[1];
    return target ?? stop(message('prCreate.noDefaultBranch'));
}

function loginOf(host, remote) {
    if (host !== 'github') return undefined;
    const check = runHostSkill(host, ['check', '--json', '--remote', remote.name]);
    if (check.status !== 0) return stop(check.stderr.trim() || message('prCreate.skillFailed', { skill: HOST_SKILL[host].skill }));
    try {
        return JSON.parse(check.stdout).login || undefined;
    } catch {
        return stop(message('preflight.unreadableCheck', { skill: HOST_SKILL[host].skill, text: check.stdout.trim().slice(0, 200) }));
    }
}

async function checkIdentity({ host, remote, target }) {
    const { profile, emailSource } = await resolveProfile({ host });
    const identity = commitIdentity();
    const account = remoteAccount(remote.url);
    const hasTargetRef = (() => {
        try {
            git('rev-parse', '--verify', '-q', `refs/remotes/${remote.name}/${target}`);
            return true;
        } catch {
            return false;
        }
    })();
    const authors = hasTargetRef ? rangeAuthors(`${remote.name}/${target}..HEAD`) : [];
    const tokenLogin = loginOf(host, remote);
    console.log(formatReport({ profile, identity, account, tokenLogin, authors, emailSource }));
    const { problems, warnings } = findMismatches({ profile, identity, authors, sshLogin: account.sshLogin, tokenLogin, stage: 'pr' });
    for (const warning of warnings) console.error(message('prCreate.warning', { warning, note: problems.length ? '' : message('prCreate.commitsCorrectNote') }));
    if (problems.length) stop(message('prCreate.identityMismatch', { problems: problems.map((problem) => `  - ${problem}`).join('\n'), advice: message('prCreate.identityAdvice') }));
}

function createArguments(args, { remote, source, target }) {
    const body = args['body-file'] ? ['--body-file', args['body-file']] : args.body === undefined ? [] : ['--body', args.body];
    return ['create', '--title', args.title, '--target', target, '--branch', source, '--remote', remote.name, ...body, ...(args['dry-run'] ? ['--dry-run'] : [])];
}

function printOutcome(args, text) {
    const urls = text.match(URL_IN_TEXT);
    console.log(args['dry-run'] || !urls ? text.trim() : urls.at(-1));
}

export async function run(argv) {
    const args = parseArgs(argv);
    if (!args.title) stop(message('prCreate.missingTitle'));
    const { host, remote } = chooseHost(args, listRemotes(process.cwd()));
    const source = args.branch || gitOrStop('branch', '--show-current');
    checkBranch(source);
    const target = args.target || defaultTarget(remote.name);
    await checkIdentity({ host, remote, target });
    const created = runHostSkill(host, createArguments(args, { remote, source, target }));
    if (created.status !== 0) {
        console.error(created.stderr.trim() || message('prCreate.skillFailed', { skill: HOST_SKILL[host].skill }));
        return created.status;
    }
    printOutcome(args, created.stdout);
    return 0;
}

async function main() {
    try {
        process.exitCode = await run(process.argv.slice(2));
    } catch (error) {
        if (!(error instanceof Stop)) throw error;
        console.error(error.message);
        process.exitCode = 1;
    }
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main();

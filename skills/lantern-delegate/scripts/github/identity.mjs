#!/usr/bin/env node
//
// identity.mjs — say which git identity commits and the PR will go out under, and check it.
//
//   node identity.mjs [--range <base>..HEAD]     report; exit 1 when a declared profile differs
//   node identity.mjs --exec <command...>        run a command with GIT_AUTHOR_*/GIT_COMMITTER_* set
//                                                from the declared profile (that command only)
//
// Expected profile: GIT_COMMIT_NAME + GIT_COMMIT_EMAIL, from the environment or .ai/.env.
// Never edits git config.

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { git, resolveIdentityVar } from '../git-env.mjs';
import { classifyRemote } from '../host.mjs';
import { EMAIL_SOURCE, profileEmail } from '../lantern-account.mjs';
import { message } from '../messages.mjs';
import { accountBehindSsh, parseRemoteUrl, sshEffective } from './github.mjs';

const SOURCE_TEXT = Object.freeze({
    [EMAIL_SOURCE.profile]: 'identity.source.profile',
    [EMAIL_SOURCE.env]: 'identity.source.env',
    [EMAIL_SOURCE.none]: 'identity.source.none',
});

const pretty = (path) => (path.startsWith(homedir()) ? path.replace(homedir(), '~') : path);

function configEntry(key) {
    let raw;
    try {
        raw = git('config', '--show-origin', '--get', key);
    } catch {
        return { value: undefined, source: 'unset' };
    }
    const tab = raw.indexOf('\t');
    const origin = raw.slice(0, tab);
    const file = origin.startsWith('file:') ? origin.slice(5) : null;
    const source = file ? pretty(file.startsWith('/') ? file : resolve(git('rev-parse', '--show-toplevel'), file)) : origin;
    return { value: raw.slice(tab + 1), source };
}

export function expectedProfile() {
    const name = resolveIdentityVar('GIT_COMMIT_NAME');
    const email = resolveIdentityVar('GIT_COMMIT_EMAIL');
    return name || email ? { name, email } : null;
}

export function hostOfRemote(remoteUrl) {
    return remoteUrl ? classifyRemote(remoteUrl).host : undefined;
}

export async function resolveProfile({ host, cwd } = {}) {
    const fromFile = expectedProfile();
    const email = await profileEmail({ host, cwd });
    if (email) return { profile: { name: fromFile?.name, email }, emailSource: EMAIL_SOURCE.profile };
    return { profile: fromFile, emailSource: fromFile?.email ? EMAIL_SOURCE.env : EMAIL_SOURCE.none };
}

export function commitEnv(profile) {
    const env = {};
    if (profile.name) Object.assign(env, { GIT_AUTHOR_NAME: profile.name, GIT_COMMITTER_NAME: profile.name });
    if (profile.email) Object.assign(env, { GIT_AUTHOR_EMAIL: profile.email, GIT_COMMITTER_EMAIL: profile.email });
    return env;
}

export function commitIdentity() {
    return { name: configEntry('user.name'), email: configEntry('user.email') };
}

export function remoteAccount(remoteUrl) {
    const parsed = remoteUrl && parseRemoteUrl(remoteUrl);
    if (!parsed?.ssh) return { via: 'https', host: parsed?.host };
    const hostname = sshEffective(parsed.host).hostname ?? parsed.host;
    const onGithub = hostname === 'github.com';
    return { via: 'ssh', host: parsed.host, hostname, onGithub, sshLogin: onGithub ? accountBehindSsh(parsed.host) : undefined };
}

export function rangeAuthors(range) {
    if (!range) return [];
    try {
        const lines = git('log', '--format=%an <%ae>', range).split('\n').filter(Boolean);
        return [...new Set(lines)];
    } catch {
        return [];
    }
}

// Every difference between the declared profile and reality, phrased for the user.
// At PR time (`stage: 'pr'`) with commits already in the range, the commits decide: a config that
// differs is only a warning, since they may have been made through `--exec`.
export function findMismatches({ profile, identity, authors, sshLogin, tokenLogin, stage = 'commit' }) {
    const problems = [];
    const warnings = [];
    if (profile) {
        const same = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
        const configTarget = stage === 'pr' && authors.length ? warnings : problems;
        if (profile.email && !same(profile.email, identity.email.value)) {
            configTarget.push(
                `user.email: expected ${profile.email} (declared in .ai/.env / environment), repo would commit as ${identity.email.value ?? 'nothing (unset)'} (from ${identity.email.source})`,
            );
        }
        if (profile.name && profile.name !== identity.name.value) {
            configTarget.push(
                `user.name: expected ${profile.name}, repo would commit as ${identity.name.value ?? 'nothing (unset)'} (from ${identity.name.source})`,
            );
        }
        for (const author of authors) {
            const email = author.match(/<(.*)>/)?.[1];
            if (profile.email && !same(profile.email, email)) {
                problems.push(`commit already on the branch: authored as ${author}, expected ${profile.email}`);
            }
        }
    }
    if (sshLogin && tokenLogin && sshLogin.toLowerCase() !== tokenLogin.toLowerCase()) {
        problems.push(`the push goes out as GitHub account ${sshLogin} (SSH), the PR as ${tokenLogin} (GITHUB_TOKEN)`);
    }
    return { problems, warnings };
}

export function formatReport({ profile, identity, account, tokenLogin, authors, emailSource }) {
    const lines = [
        'Git identity',
        `  commits authored as : ${identity.name.value ?? '(unset)'} <${identity.email.value ?? 'unset'}>`,
        `    user.name  from   : ${identity.name.source}`,
        `    user.email from   : ${identity.email.source}`,
    ];
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) {
        if (process.env[key]) lines.push(`  note: ${key} is set in the environment and overrides git config`);
    }
    if (authors.length) lines.push(`  commits to be pushed: ${authors.join('; ')}`);
    if (account.via === 'ssh') {
        lines.push(
            `  push account        : SSH host "${account.host}"${account.hostname && account.hostname !== account.host ? ` (-> ${account.hostname})` : ''}, ${account.onGithub ? `GitHub login ${account.sshLogin ?? 'could not be determined'}` : 'no account lookup for this host'}`,
        );
    } else {
        lines.push(`  push account        : ${account.via} remote${account.host ? ` (${account.host})` : ''}, credentials from your git credential helper`);
    }
    lines.push(`  PR account          : ${tokenLogin ? `${tokenLogin} (GITHUB_TOKEN)` : 'unknown (token not validated)'}`);
    if (emailSource) lines.push(`  e-mail from         : ${message(SOURCE_TEXT[emailSource])}`);
    lines.push(
        `  expected profile    : ${profile ? `${profile.name ?? '(any name)'} <${profile.email ?? 'any'}>` : 'none declared (set GIT_COMMIT_NAME / GIT_COMMIT_EMAIL in .ai/.env to enforce)'}`,
    );
    return lines.join('\n');
}

function originUrl() {
    try {
        return git('config', '--get', 'remote.origin.url');
    } catch {
        return undefined;
    }
}

async function main() {
    const argv = process.argv.slice(2);
    const execAt = argv.indexOf('--exec');
    if (execAt !== -1) {
        const command = argv.slice(execAt + 1);
        if (!command.length) {
            console.error(message('identity.execNeedsCommand'));
            process.exit(1);
        }
        const { profile } = await resolveProfile({ host: hostOfRemote(originUrl()) });
        const env = { ...process.env, ...commitEnv(profile ?? {}) };
        if (!profile?.name || !profile?.email) console.error(message('identity.partialProfile'));
        process.exit(spawnSync(command[0], command.slice(1), { stdio: 'inherit', env }).status ?? 1);
    }
    const range = argv[argv.indexOf('--range') + 1];
    const remoteUrl = originUrl();
    const { profile, emailSource } = await resolveProfile({ host: hostOfRemote(remoteUrl) });
    const identity = commitIdentity();
    const authors = argv.includes('--range') ? rangeAuthors(range) : [];
    const account = remoteAccount(remoteUrl);
    console.log(formatReport({ profile, identity, account, tokenLogin: undefined, authors, emailSource }));
    const { problems } = findMismatches({ profile, identity, authors });
    if (problems.length) {
        console.error(`\nIdentity mismatch:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
        process.exit(1);
    }
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main();

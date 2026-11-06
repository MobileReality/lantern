// Which host a repo's remote points at, and which remote to use. Importable; the pure parts take
// their inputs as arguments so they can be tested without a repository or a network.

import { spawnSync } from 'node:child_process';

import { parseRemoteUrl, sshEffective } from './github/github.mjs';

const defaultHostname = (host) => sshEffective(host).hostname ?? host;

// `{ host: 'bitbucket' | 'github', parsed }`, or `{ error }` for an unreadable URL or any other host.
// An SSH alias is resolved with `ssh -G` (`resolveHostname` replaces that lookup in tests).
export function classifyRemote(url, resolveHostname = defaultHostname, rawUrl = url) {
    const parsed = parseRemoteUrl(url);
    if (!parsed) {
        const rewritten = rawUrl !== url ? ` (configured as "${rawUrl}", rewritten by url.<base>.insteadOf to "${url}")` : '';
        return { error: `cannot read a host from remote URL "${url}"${rewritten}; the host is unknown, so the delegate could not push or open a pull request.` };
    }
    const hostname = parsed.ssh ? resolveHostname(parsed.host) : parsed.host;
    if (hostname === 'bitbucket.org') return { host: 'bitbucket', parsed };
    if (hostname === 'github.com' || hostname === 'www.github.com') return { host: 'github', parsed };
    return { error: `remote host "${hostname}" is neither bitbucket.org nor github.com; delegates open pull requests on those two only.` };
}

// `remotes` is `[{ name, url }]`. A name wins, then an owner/repo pair, then the only remote.
// Several remotes and no way to choose is an error: pushing to the wrong one cannot be undone quietly.
export function pickRemote(remotes, { name, owner, repo } = {}) {
    if (!remotes.length) return { error: 'the repository has no remote. Use a repo whose remote is on bitbucket.org or github.com.' };
    if (name) {
        const named = remotes.find((r) => r.name === name);
        return named ? { remote: named } : { error: `no remote named "${name}" (have: ${remotes.map((r) => r.name).join(', ')}).` };
    }
    if (owner && repo) {
        const match = remotes.find((r) => {
            const parsed = parseRemoteUrl(r.url);
            return parsed && parsed.owner === owner && parsed.repo === repo;
        });
        return match ? { remote: match } : { error: `no remote points at ${owner}/${repo}.` };
    }
    if (remotes.length === 1) return { remote: remotes[0] };
    return { error: `${remotes.length} remotes (${remotes.map((r) => r.name).join(', ')}) and none chosen. Ask the user which one, then pass --remote, or --owner and --repo.` };
}

function gitOut(dir, ...args) {
    const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return result.status === 0 ? result.stdout.trim() : null;
}

// `[{ name, url, rawUrl }]`: `url` is the effective one (after `url.<base>.insteadOf`), the URL git
// really uses; `rawUrl` is what the config holds.
export function listRemotes(dir) {
    const names = (gitOut(dir, 'remote') ?? '').split('\n').filter(Boolean);
    return names.flatMap((name) => {
        const url = gitOut(dir, 'remote', 'get-url', name);
        if (url === null) return [];
        const rawUrl = gitOut(dir, 'config', '--get', `remote.${name}.url`) || url;
        return [{ name, url, rawUrl }];
    });
}

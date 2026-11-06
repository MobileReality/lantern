// GitHub remote parsing and the ssh account lookups. Importable; no side effects.

import { execFileSync } from 'node:child_process';

// scp-style (git@host:owner/repo), ssh:// and https:// forms. `host` may be an ~/.ssh/config alias.
export function parseRemoteUrl(url) {
    const m =
        url.match(/^[^@/\s]+@([^:/\s]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ||
        url.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/) ||
        url.match(/^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    return m ? { host: m[1], owner: m[2], repo: m[3], ssh: !/^https?:/.test(url) } : null;
}

// `ssh -G` prints the effective config, which resolves an alias like github-account2 to its HostName.
export function sshEffective(host) {
    try {
        const out = execFileSync('ssh', ['-G', host], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const pick = (key) => out.match(new RegExp(`^${key} (.+)$`, 'mi'))?.[1];
        return { hostname: pick('hostname'), identityFile: pick('identityfile') };
    } catch {
        return {};
    }
}

export function isGithubHost(host, ssh) {
    if (host === 'github.com' || host === 'www.github.com') return true;
    return ssh && sshEffective(host).hostname === 'github.com';
}

export function accountBehindSsh(host) {
    try {
        execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-T', `git@${host}`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return undefined;
    } catch (e) {
        // GitHub's shell-less greeting exits 1 and says "Hi <login>!" on stderr.
        return String(e.stderr ?? '').match(/Hi ([^!\s]+)!/)?.[1];
    }
}

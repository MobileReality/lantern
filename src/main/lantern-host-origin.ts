import { execFile } from 'node:child_process';
import { CODE_HOST_IDS, PROVIDER, PROVIDERS } from '@shared/providers';
import type { CodeHostId } from '@shared/providers';
import { git } from './lantern-git';

const CODE_HOSTS = new Map(
  CODE_HOST_IDS.flatMap((id) => {
    const { remoteHost } = PROVIDERS[id];
    return remoteHost ? [[remoteHost, id] as const] : [];
  }),
);
const SSH_TIMEOUT_MS = 3000;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REMOTE_FORMS = [
  /^[^@/\s]+@([^:/\s]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];

interface RemoteUrl {
  host: string;
  owner: string;
  repo: string;
  ssh: boolean;
}

interface BitbucketRepo {
  workspace: string;
  repo: string;
}

interface CodeHost {
  provider: CodeHostId;
  owner: string;
  repo: string;
}

type HostnameResolver = (alias: string) => Promise<string | null>;

function parseRemoteUrl(url: string): RemoteUrl | null {
  for (const form of REMOTE_FORMS) {
    const match = form.exec(url);
    if (match) return { host: match[1], owner: match[2], repo: match[3], ssh: !/^https?:/.test(url) };
  }
  return null;
}

function sshHostname(alias: string): Promise<string | null> {
  if (!SAFE_NAME.test(alias)) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('ssh', ['-G', alias], { timeout: SSH_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : (/^hostname (.+)$/im.exec(String(stdout))?.[1].trim() ?? null));
    });
  });
}

async function codeHostOf(root: string, resolveHostname: HostnameResolver = sshHostname): Promise<CodeHost | null> {
  const origin = await git(root, ['remote', 'get-url', 'origin']);
  const remote = origin.ok ? parseRemoteUrl(origin.stdout.trim()) : null;
  if (!remote || !SAFE_NAME.test(remote.owner) || !SAFE_NAME.test(remote.repo)) return null;
  const direct = CODE_HOSTS.has(remote.host.toLowerCase());
  const hostname = remote.ssh && !direct ? await resolveHostname(remote.host) : remote.host;
  const provider = hostname ? CODE_HOSTS.get(hostname.toLowerCase()) : undefined;
  return provider ? { provider, owner: remote.owner, repo: remote.repo } : null;
}

async function bitbucketRepoOf(root: string, resolveHostname: HostnameResolver = sshHostname): Promise<BitbucketRepo | null> {
  const host = await codeHostOf(root, resolveHostname);
  return host?.provider === PROVIDER.bitbucket ? { workspace: host.owner, repo: host.repo } : null;
}

export { bitbucketRepoOf, codeHostOf, parseRemoteUrl };
export type { BitbucketRepo, CodeHost, HostnameResolver, RemoteUrl };

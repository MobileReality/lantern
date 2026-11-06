import { execFileSync } from 'node:child_process';
import { SkillError } from './http.mjs';
import { message } from './messages.mjs';

const REMOTE_PATTERNS = [
  /^[^@/\s]+@([^:/\s]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const HOSTNAME_LINE = /^hostname (.+)$/im;
const SSH_TIMEOUT_MS = 5000;

export function parseRemoteUrl(url) {
  const found = REMOTE_PATTERNS.map((pattern) => pattern.exec(url ?? '')).find(Boolean);
  return found ? { host: found[1], owner: found[2], repo: found[3], ssh: !/^https?:/.test(url) } : null;
}

export function resolveSshHostname(host) {
  try {
    const out = execFileSync('ssh', ['-G', '--', host], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: SSH_TIMEOUT_MS });
    return HOSTNAME_LINE.exec(out)?.[1] ?? host;
  } catch {
    return host;
  }
}

const isGithub = (parsed, resolveHostname) => GITHUB_HOSTS.has(parsed.host) || (parsed.ssh && GITHUB_HOSTS.has(resolveHostname(parsed.host)));

const attempt = (read) => {
  try {
    return read();
  } catch {
    return null;
  }
};

export function githubRemotes(git, resolveHostname = resolveSshHostname) {
  return git('remote')
    .split('\n')
    .filter(Boolean)
    .flatMap((name) => {
      const urls = [attempt(() => git('remote', 'get-url', name)), attempt(() => git('config', '--get', `remote.${name}.url`))];
      const parsed = urls.map(parseRemoteUrl).find((candidate) => candidate && isGithub(candidate, resolveHostname));
      return parsed ? [{ name, owner: parsed.owner, repo: parsed.repo }] : [];
    });
}

const SELECTORS = [
  { applies: (options) => options.remote !== undefined, narrow: (remotes, options) => remotes.filter((remote) => remote.name === options.remote), none: 'remote.noneNamed' },
  { applies: () => true, narrow: (remotes) => remotes, none: 'remote.noneFound' },
];

export function chooseRemote(remotes, options) {
  const selector = SELECTORS.find((candidate) => candidate.applies(options));
  const matches = selector.narrow(remotes, options);
  if (!matches.length) throw new SkillError(message(selector.none, { name: options.remote ?? '' }));
  if (matches.length > 1) throw new SkillError(message('remote.severalFound', { names: matches.map((remote) => remote.name).join(', ') }));
  return matches[0];
}

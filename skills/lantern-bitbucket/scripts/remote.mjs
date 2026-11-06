import { SkillError } from './http.mjs';
import { message } from './messages.mjs';

const REMOTE_PATTERN = /bitbucket\.org[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

export function parseRemote(url) {
  const found = REMOTE_PATTERN.exec(url ?? '');
  return found ? { workspace: found[1], repo: found[2] } : null;
}

const attempt = (read) => {
  try {
    return read();
  } catch {
    return null;
  }
};

export function bitbucketRemotes(git) {
  return git('remote')
    .split('\n')
    .filter(Boolean)
    .flatMap((name) => {
      const urls = [attempt(() => git('remote', 'get-url', name)), attempt(() => git('config', '--get', `remote.${name}.url`))];
      const parsed = urls.map(parseRemote).find(Boolean);
      return parsed ? [{ name, ...parsed }] : [];
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

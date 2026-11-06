import { OPTION, readBody, readLimit } from './args.mjs';
import { BLOCK_OPTIONS, readBlock, withBlock } from './block.mjs';
import { SOURCE_MESSAGE } from './credentials.mjs';
import { assertReadyToPublish, currentBranch, defaultBranch, pushBranch } from './git.mjs';
import { LOCATION, createConventions } from './conventions.mjs';
import { SkillError, ensureOk } from './http.mjs';
import { message } from './messages.mjs';
import { chooseRemote, githubRemotes } from './remote.mjs';

const PR_NUMBER = /^#?(\d+)$/;
const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 100;
const REMOTE_OPTIONS = { remote: OPTION.value };
const JSON_OPTIONS = { ...REMOTE_OPTIONS, json: OPTION.flag };
const BODY_OPTIONS = { ...REMOTE_OPTIONS, body: OPTION.value, 'body-file': OPTION.value };

const enc = encodeURIComponent;
const asJson = (data) => [JSON.stringify(data, null, 2)];

function pullRequestNumber(raw) {
  const found = PR_NUMBER.exec(raw.trim());
  if (!found) throw new SkillError(message('pr.badId', { id: raw }));
  return found[1];
}

function locate({ git, options }) {
  const remote = chooseRemote(githubRemotes(git), options);
  return { remote, base: `/repos/${enc(remote.owner)}/${enc(remote.repo)}` };
}

const row = (pr) => message('pr.row', { id: pr.number, title: pr.title, source: pr.head?.ref ?? message('pr.unknown'), target: pr.base?.ref ?? message('pr.unknown'), author: pr.user?.login ?? message('pr.unknown'), url: pr.html_url ?? '' });

async function listPullRequests(context) {
  const { api, options } = context;
  const { base } = locate(context);
  const query = new URLSearchParams({ state: 'open', per_page: String(readLimit(options, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)) });
  const { data } = ensureOk(await api.get(`${base}/pulls?${query}`), message('pr.action.list'));
  if (options.json) return asJson(data);
  return Array.isArray(data) && data.length ? data.map(row) : [message('pr.noneOpen')];
}

function renderPullRequest(pr) {
  const description = (pr.body ?? '').trim();
  return [
    message('pr.title', { id: pr.number, title: pr.title }),
    message('pr.field.state', { state: pr.merged ? message('pr.merged') : pr.state }),
    message('pr.field.author', { author: pr.user?.login ?? message('pr.unknown') }),
    message('pr.field.branches', { source: pr.head?.ref ?? message('pr.unknown'), target: pr.base?.ref ?? message('pr.unknown') }),
    message('pr.field.url', { url: pr.html_url ?? '' }),
    ...(description ? ['', description] : []),
  ];
}

async function showPullRequest(context) {
  const id = pullRequestNumber(context.positionals.id);
  const { base } = locate(context);
  const { data } = ensureOk(await context.api.get(`${base}/pulls/${id}`), message('pr.action.show', { id }));
  return context.options.json ? asJson(data) : renderPullRequest(data);
}

async function commentOnPullRequest(context) {
  const id = pullRequestNumber(context.positionals.id);
  const body = readBody(context.options);
  const { base } = locate(context);
  const { data } = ensureOk(await context.api.post(`${base}/issues/${id}/comments`, { body }), message('pr.action.comment', { id }));
  return [message('pr.commented', { id, url: data?.html_url ?? '' })];
}

async function findOpenForBranch(api, base, owner, source) {
  const query = new URLSearchParams({ head: `${owner}:${source}`, state: 'open' });
  const { data } = ensureOk(await api.get(`${base}/pulls?${query}`), message('pr.action.lookup'));
  return Array.isArray(data) ? (data[0] ?? null) : null;
}

async function createPullRequest(context) {
  const { api, git, options } = context;
  const title = options.title?.trim();
  if (!title) throw new SkillError(message('pr.titleRequired'));
  const body = readBody(options, { optional: true });
  const { remote, base } = locate(context);
  const source = options.branch ?? currentBranch(git);
  const target = options.target ?? defaultBranch(git, remote.name);
  assertReadyToPublish(git, remote.name, source, target);
  const existing = await findOpenForBranch(api, base, remote.owner, source);
  if (existing) {
    if (!options['dry-run']) pushBranch(git, remote.name, source);
    return [message('pr.exists', { id: existing.number, url: existing.html_url ?? '' })];
  }
  const payload = { title, head: source, base: target, body };
  if (options['dry-run']) return [message('pr.dryRun', { remote: remote.name, source, target, owner: remote.owner, repo: remote.repo }), JSON.stringify(payload, null, 2)];
  pushBranch(git, remote.name, source);
  const { data } = ensureOk(await api.post(`${base}/pulls`, payload), message('pr.action.create'));
  return [message('pr.created', { id: data?.number ?? '', url: data?.html_url ?? '' })];
}

async function checkAccess(context) {
  const { api, options, source } = context;
  const result = { source };
  if (!options.offline) {
    const { remote, base } = locate(context);
    const slug = `${remote.owner}/${remote.repo}`;
    const { data: account } = ensureOk(await api.get('/user'), message('check.action.account'));
    ensureOk(await api.get(base), message('check.action.repository', { slug }));
    Object.assign(result, { login: account?.login ?? '', repository: slug });
  }
  if (options.json) return asJson(result);
  const found = message('check.credentials', { source: message(SOURCE_MESSAGE[source]) });
  return [found, options.offline ? message('check.offline') : message('check.authenticated', { login: result.login, slug: result.repository })];
}

async function writeDescriptionBlock(context) {
  const number = pullRequestNumber(context.positionals.id);
  const block = readBlock(context.options);
  const { base } = locate(context);
  const { data: pr } = ensureOk(await context.api.get(`${base}/pulls/${number}`), message('pr.action.show', { id: number }));
  const { data } = ensureOk(await context.api.patch(`${base}/pulls/${number}`, { body: withBlock(pr.body, block) }), message('pr.action.update', { id: number }));
  return [message('pr.blockWritten', { name: block.name, id: number, url: data?.html_url ?? pr.html_url ?? '' })];
}

const conventions = createConventions({
  kinds: ['pr'],
  repoLocations: [
    { path: '.github/pull_request_template.md', type: LOCATION.file },
    { path: '.github/PULL_REQUEST_TEMPLATE.md', type: LOCATION.file },
    { path: 'pull_request_template.md', type: LOCATION.file },
    { path: 'docs/pull_request_template.md', type: LOCATION.file },
    { path: '.github/PULL_REQUEST_TEMPLATE', type: LOCATION.folder },
    { path: '.github/ISSUE_TEMPLATE', type: LOCATION.folder },
  ],
});

const help = () => [message('usage.header'), ...Object.keys(COMMANDS).map((name) => message(`usage.${name}`))];

export const COMMANDS = Object.freeze({
  list: { positionals: [], options: { ...JSON_OPTIONS, limit: OPTION.value }, needsCredentials: true, run: listPullRequests },
  show: { positionals: ['id'], options: JSON_OPTIONS, needsCredentials: true, run: showPullRequest },
  create: { positionals: [], options: { ...BODY_OPTIONS, title: OPTION.value, target: OPTION.value, branch: OPTION.value, 'dry-run': OPTION.flag }, needsCredentials: true, run: createPullRequest },
  comment: { positionals: ['id'], options: BODY_OPTIONS, needsCredentials: true, run: commentOnPullRequest },
  'description-block': { positionals: ['id'], options: { ...REMOTE_OPTIONS, ...BLOCK_OPTIONS }, needsCredentials: true, run: writeDescriptionBlock },
  check: { positionals: [], options: { ...JSON_OPTIONS, offline: OPTION.flag }, needsCredentials: true, run: checkAccess },
  conventions: { positionals: [], options: JSON_OPTIONS, needsCredentials: false, run: conventions.list },
  template: { positionals: ['action', 'kind'], options: { file: OPTION.value, force: OPTION.flag }, needsCredentials: false, run: conventions.template },
  help: { positionals: [], options: {}, needsCredentials: false, run: help },
});

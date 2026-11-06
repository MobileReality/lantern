import { OPTION, readBody, readLimit } from './args.mjs';
import { BLOCK_OPTIONS, readBlock, withBlock } from './block.mjs';
import { assertReadyToPublish, currentBranch, defaultBranch, pushBranch } from './git.mjs';
import { SOURCE_MESSAGE } from './credentials.mjs';
import { LOCATION, createConventions } from './conventions.mjs';
import { SkillError, ensureOk } from './http.mjs';
import { message } from './messages.mjs';
import { bitbucketRemotes, chooseRemote } from './remote.mjs';

const PR_ID = /^#?(\d+)$/;
const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 50;
const LIST_FIELDS = 'values.id,values.title,values.author.display_name,values.source.branch.name,values.destination.branch.name,values.links.html.href';
const LOOKUP_FIELDS = 'values.id,values.links.html.href';
const REMOTE_OPTIONS = { remote: OPTION.value };
const JSON_OPTIONS = { ...REMOTE_OPTIONS, json: OPTION.flag };
const BODY_OPTIONS = { ...REMOTE_OPTIONS, body: OPTION.value, 'body-file': OPTION.value };
const WRITE_SCOPE = 'write:pullrequest';

const enc = encodeURIComponent;
const asJson = (data) => [JSON.stringify(data, null, 2)];
const urlOf = (pr) => pr?.links?.html?.href ?? '';

function pullRequestId(raw) {
  const found = PR_ID.exec(raw.trim());
  if (!found) throw new SkillError(message('pr.badId', { id: raw }));
  return found[1];
}

function locate({ git, options }) {
  const remote = chooseRemote(bitbucketRemotes(git), options);
  const repository = `/repositories/${enc(remote.workspace)}/${enc(remote.repo)}`;
  return { remote, repository, base: `${repository}/pullrequests` };
}

const row = (pr) => message('pr.row', { id: pr.id, title: pr.title, source: pr.source?.branch?.name ?? message('pr.unknown'), target: pr.destination?.branch?.name ?? message('pr.unknown'), author: pr.author?.display_name ?? message('pr.unknown'), url: urlOf(pr) });

async function listPullRequests(context) {
  const { api, options } = context;
  const { base } = locate(context);
  const query = new URLSearchParams({ state: 'OPEN', pagelen: String(readLimit(options, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)), fields: LIST_FIELDS });
  const { data } = ensureOk(await api.get(`${base}?${query}`), message('pr.action.list'));
  if (options.json) return asJson(data);
  const open = data?.values ?? [];
  return open.length ? open.map(row) : [message('pr.noneOpen')];
}

function renderPullRequest(pr) {
  const description = (pr.description ?? '').trim();
  return [
    message('pr.title', { id: pr.id, title: pr.title }),
    message('pr.field.state', { state: pr.state }),
    message('pr.field.author', { author: pr.author?.display_name ?? message('pr.unknown') }),
    message('pr.field.branches', { source: pr.source?.branch?.name ?? message('pr.unknown'), target: pr.destination?.branch?.name ?? message('pr.unknown') }),
    message('pr.field.url', { url: urlOf(pr) }),
    ...(description ? ['', description] : []),
  ];
}

async function showPullRequest(context) {
  const id = pullRequestId(context.positionals.id);
  const { base } = locate(context);
  const { data } = ensureOk(await context.api.get(`${base}/${id}`), message('pr.action.show', { id }));
  return context.options.json ? asJson(data) : renderPullRequest(data);
}

async function commentOnPullRequest(context) {
  const id = pullRequestId(context.positionals.id);
  const raw = readBody(context.options);
  const { base } = locate(context);
  const { data } = ensureOk(await context.api.post(`${base}/${id}/comments`, { content: { raw } }), message('pr.action.comment', { id }));
  return [message('pr.commented', { id, url: data?.links?.html?.href ?? '' })];
}

async function findOpenForBranch(api, base, source) {
  const query = new URLSearchParams({ q: `source.branch.name=${JSON.stringify(source)} AND state="OPEN"`, fields: LOOKUP_FIELDS });
  const { data } = ensureOk(await api.get(`${base}?${query}`), message('pr.action.lookup'));
  return data?.values?.[0] ?? null;
}

async function createPullRequest(context) {
  const { api, git, options } = context;
  const title = options.title?.trim();
  if (!title) throw new SkillError(message('pr.titleRequired'));
  const description = readBody(options, { optional: true });
  const { remote, base } = locate(context);
  const source = options.branch ?? currentBranch(git);
  const target = options.target ?? defaultBranch(git, remote.name);
  assertReadyToPublish(git, remote.name, source, target);
  const existing = await findOpenForBranch(api, base, source);
  if (existing) {
    if (!options['dry-run']) pushBranch(git, remote.name, source);
    return [message('pr.exists', { id: existing.id, url: urlOf(existing) })];
  }
  const payload = { title, description, source: { branch: { name: source } }, destination: { branch: { name: target } }, close_source_branch: false };
  if (options['dry-run']) return [message('pr.dryRun', { remote: remote.name, source, target, workspace: remote.workspace, repo: remote.repo }), JSON.stringify(payload, null, 2)];
  pushBranch(git, remote.name, source);
  const { data } = ensureOk(await api.post(base, payload), message('pr.action.create'));
  return [message('pr.created', { id: data?.id ?? '', url: urlOf(data) })];
}

async function checkAccess(context) {
  const { api, options, source } = context;
  const result = { source };
  if (!options.offline) {
    const { remote, repository } = locate(context);
    const slug = `${remote.workspace}/${remote.repo}`;
    ensureOk(await api.get(repository), message('check.action.repository', { slug }));
    const granted = api.scopes();
    if (!granted.some((scope) => scope.startsWith(WRITE_SCOPE))) throw new SkillError(message('check.scopeMissing', { scope: WRITE_SCOPE, granted: granted.join(', ') || message('check.noScopes') }));
    Object.assign(result, { repository: slug, scopes: granted });
  }
  if (options.json) return asJson(result);
  const found = message('check.credentials', { source: message(SOURCE_MESSAGE[source]) });
  return [found, options.offline ? message('check.offline') : message('check.scopeOk', { scope: WRITE_SCOPE, slug: result.repository })];
}

async function writeDescriptionBlock(context) {
  const id = pullRequestId(context.positionals.id);
  const block = readBlock(context.options);
  const { base } = locate(context);
  const { data: pr } = ensureOk(await context.api.get(`${base}/${id}`), message('pr.action.show', { id }));
  const description = withBlock(pr.description, block);
  const { data } = ensureOk(await context.api.put(`${base}/${id}`, { title: pr.title, description }), message('pr.action.update', { id }));
  return [message('pr.blockWritten', { name: block.name, id, url: urlOf(data) || urlOf(pr) })];
}

const conventions = createConventions({
  kinds: ['pr'],
  repoLocations: [
    { path: 'pull_request_template.md', type: LOCATION.file },
    { path: '.bitbucket/pull_request_template.md', type: LOCATION.file },
    { path: 'docs/pull_request_template.md', type: LOCATION.file },
    { path: '.github/pull_request_template.md', type: LOCATION.file },
    { path: '.github/PULL_REQUEST_TEMPLATE.md', type: LOCATION.file },
    { path: '.github/PULL_REQUEST_TEMPLATE', type: LOCATION.folder },
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

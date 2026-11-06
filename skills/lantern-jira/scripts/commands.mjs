import { adfToText, textToAdf } from './adf.mjs';
import { OPTION, readBody, readLimit } from './args.mjs';
import { LOCATION, createConventions } from './conventions.mjs';
import { SkillError, ensureOk } from './http.mjs';
import { REST } from './jira-api.mjs';
import { message } from './messages.mjs';

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;
const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 100;
const SEARCH_FIELDS = ['summary', 'status', 'assignee', 'issuetype'];
const ISSUE_FIELDS = 'summary,status,issuetype,priority,assignee,reporter,labels,parent,description';
const JSON_OPTIONS = { json: OPTION.flag };

const ISSUE_ROWS = [
  ['jira.field.status', (fields) => fields.status?.name],
  ['jira.field.type', (fields) => fields.issuetype?.name],
  ['jira.field.priority', (fields) => fields.priority?.name],
  ['jira.field.assignee', (fields) => fields.assignee?.displayName],
  ['jira.field.reporter', (fields) => fields.reporter?.displayName],
  ['jira.field.labels', (fields) => (fields.labels?.length ? fields.labels.join(', ') : undefined)],
  ['jira.field.parent', (fields) => fields.parent?.key],
];

function issueKey(raw) {
  const key = raw.trim().toUpperCase();
  if (!KEY_PATTERN.test(key)) throw new SkillError(message('jira.badKey', { key: raw }));
  return key;
}

const issuePath = (key) => `${REST}/issue/${encodeURIComponent(key)}`;
const asJson = (data) => [JSON.stringify(data, null, 2)];
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function renderIssue(api, issue) {
  const fields = issue.fields ?? {};
  const rows = ISSUE_ROWS.flatMap(([label, read]) => {
    const value = read(fields);
    return value ? [`${message(label)}: ${value}`] : [];
  });
  const description = adfToText(fields.description).trim();
  return [
    message('jira.issue.title', { key: issue.key, summary: fields.summary ?? '' }),
    ...rows,
    message('jira.field.url', { url: `${api.site}/browse/${issue.key}` }),
    ...(description ? ['', description] : []),
  ];
}

async function getIssue({ api, positionals, options }) {
  const key = issueKey(positionals.key);
  const { data } = ensureOk(await api.get(`${issuePath(key)}?fields=${ISSUE_FIELDS}`), message('jira.action.get', { key }));
  return options.json ? asJson(data) : renderIssue(api, data);
}

async function searchIssues({ api, positionals, options }) {
  const maxResults = readLimit(options, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT);
  const { data } = ensureOk(await api.post(`${REST}/search/jql`, { jql: positionals.jql, fields: SEARCH_FIELDS, maxResults }), message('jira.action.search'));
  if (options.json) return asJson(data);
  const issues = data?.issues ?? [];
  if (!issues.length) return [message('jira.noResults')];
  return issues.map((issue) => message('jira.searchRow', { key: issue.key, status: issue.fields?.status?.name ?? message('jira.noValue'), summary: issue.fields?.summary ?? '' }));
}

async function addComment({ api, positionals, options }) {
  const key = issueKey(positionals.key);
  const body = textToAdf(readBody(options));
  const { data } = ensureOk(await api.post(`${issuePath(key)}/comment`, { body }), message('jira.action.comment', { key }));
  return [message('jira.commented', { key, id: data?.id ?? '' })];
}

async function setDescription({ api, positionals, options }) {
  const key = issueKey(positionals.key);
  const description = textToAdf(readBody(options));
  ensureOk(await api.put(issuePath(key), { fields: { description } }), message('jira.action.describe', { key }));
  return [message('jira.described', { key })];
}

async function fetchTransitions(api, key) {
  const { data } = ensureOk(await api.get(`${issuePath(key)}/transitions`), message('jira.action.transitions', { key }));
  return data?.transitions ?? [];
}

const transitionRow = (transition) => message('jira.transitionRow', { id: transition.id, name: transition.name, target: transition.to?.name ?? transition.name });

async function listTransitions({ api, positionals, options }) {
  const transitions = await fetchTransitions(api, issueKey(positionals.key));
  if (options.json) return asJson(transitions);
  return transitions.length ? transitions.map(transitionRow) : [message('jira.noTransitions')];
}

async function transitionIssue({ api, positionals }) {
  const key = issueKey(positionals.key);
  const transitions = await fetchTransitions(api, key);
  const wanted = positionals.status;
  const match = transitions.find((transition) => sameName(transition.name, wanted)) ?? transitions.find((transition) => sameName(transition.to?.name, wanted));
  if (!match) throw new SkillError(message('jira.noSuchTransition', { key, status: wanted, available: transitions.map((t) => t.to?.name ?? t.name).join(', ') || message('jira.noValue') }));
  ensureOk(await api.post(`${issuePath(key)}/transitions`, { transition: { id: match.id } }), message('jira.action.transition', { key }));
  return [message('jira.transitioned', { key, status: match.to?.name ?? match.name })];
}

const conventions = createConventions({
  kinds: ['ticket'],
  repoLocations: [
    { path: '.github/ISSUE_TEMPLATE.md', type: LOCATION.file },
    { path: '.github/ISSUE_TEMPLATE', type: LOCATION.folder },
    { path: 'ISSUE_TEMPLATE.md', type: LOCATION.file },
    { path: 'docs/ISSUE_TEMPLATE.md', type: LOCATION.file },
  ],
});

const help = () => [message('usage.header'), ...Object.keys(COMMANDS).map((name) => message(`usage.${name}`))];

export const COMMANDS = Object.freeze({
  get: { positionals: ['key'], options: JSON_OPTIONS, needsCredentials: true, run: getIssue },
  search: { positionals: ['jql'], options: { ...JSON_OPTIONS, limit: OPTION.value }, needsCredentials: true, run: searchIssues },
  comment: { positionals: ['key'], options: { body: OPTION.value, 'body-file': OPTION.value }, needsCredentials: true, run: addComment },
  describe: { positionals: ['key'], options: { body: OPTION.value, 'body-file': OPTION.value }, needsCredentials: true, run: setDescription },
  transitions: { positionals: ['key'], options: JSON_OPTIONS, needsCredentials: true, run: listTransitions },
  transition: { positionals: ['key', 'status'], options: {}, joinRest: true, needsCredentials: true, run: transitionIssue },
  conventions: { positionals: [], options: JSON_OPTIONS, needsCredentials: false, run: conventions.list },
  template: { positionals: ['action', 'kind'], options: { file: OPTION.value, force: OPTION.flag }, needsCredentials: false, run: conventions.template },
  help: { positionals: [], options: {}, needsCredentials: false, run: help },
});

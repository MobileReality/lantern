import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRouter, fakeFetch } from './helpers/fake-host';
import { fakeAtlassianToken } from './helpers/fake-tokens';
import type { Route, Router } from './helpers/fake-host';
import { SKILLS_ROOT, runSkill } from './helpers/skill-runner';

const SITE = 'https://example.atlassian.net';
const GATEWAY = 'https://api.atlassian.com/ex/jira/cloud-1';
const TOKEN = fakeAtlassianToken('jira-token-3f9a');
const ENV = { ATLASSIAN_EMAIL: 'dev@example.com', GLOBAL_ATLASSIAN_TOKEN: TOKEN, ATLASSIAN_BASE_URL: SITE };
const BASIC = `Basic ${Buffer.from(`dev@example.com:${TOKEN}`).toString('base64')}`;

const ISSUE = {
  key: 'PROJ-1',
  fields: {
    summary: 'Fix the login redirect',
    status: { name: 'In Progress' },
    issuetype: { name: 'Bug' },
    priority: { name: 'High' },
    assignee: { displayName: 'Ada Example' },
    labels: ['auth', 'web'],
    description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Users land on a blank page.' }] }] },
  },
};
const TRANSITIONS = {
  transitions: [
    { id: '11', name: 'Start review', to: { name: 'In Review' } },
    { id: '31', name: 'Finish', to: { name: 'Done' } },
  ],
};

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-jira-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function jira(routes: Route[], argv: string[], env: Record<string, string> = ENV) {
  const router = createRouter(routes);
  return runSkill('lantern-jira', argv, { env, fetch: fakeFetch(router) }).then((result) => ({ ...result, router }));
}

const sent = (router: Router) => router.calls.filter((call) => !call.url.includes('/_edge/'));

const issueRoute: Route = { method: 'GET', url: `${SITE}/rest/api/3/issue/PROJ-1?`, reply: { body: ISSUE } };
const transitionsRoute: Route = { method: 'GET', url: `${SITE}/rest/api/3/issue/PROJ-1/transitions`, reply: { body: TRANSITIONS } };

describe('lantern-jira commands', () => {
  it('shows an issue with its fields and the description as text', async () => {
    const { code, out, router } = await jira([issueRoute], ['get', 'proj-1']);
    expect(code).toBe(0);
    expect(out).toContain('PROJ-1: Fix the login redirect');
    expect(out).toContain('Status: In Progress');
    expect(out).toContain('Labels: auth, web');
    expect(out).toContain(`URL: ${SITE}/browse/PROJ-1`);
    expect(out).toContain('Users land on a blank page.');
    expect(sent(router)[0].headers.authorization).toBe(BASIC);
  });

  it('prints the raw response with --json', async () => {
    const { out } = await jira([issueRoute], ['get', 'PROJ-1', '--json']);
    expect(JSON.parse(out)).toEqual(ISSUE);
  });

  it('refuses a malformed key before any request', async () => {
    const { code, err, router } = await jira([issueRoute], ['get', 'not', 'a', 'key']);
    expect(code).toBe(2);
    expect(err).toContain('Expected arguments');
    const second = await jira([issueRoute], ['get', 'nokey']);
    expect(second.code).toBe(1);
    expect(second.err).toContain('is not an issue key');
    expect(router.calls).toEqual([]);
    expect(second.router.calls).toEqual([]);
  });

  it('searches with JQL through the new search endpoint and lists rows', async () => {
    const found = { issues: [{ key: 'PROJ-2', fields: { summary: 'Second', status: { name: 'To Do' } } }] };
    const { code, out, router } = await jira([{ method: 'POST', url: `${SITE}/rest/api/3/search/jql`, reply: { body: found } }], ['search', 'project = PROJ ORDER BY created', '--limit', '5']);
    expect(code).toBe(0);
    expect(out.trim()).toBe('PROJ-2  [To Do]  Second');
    expect(sent(router)[0].body).toMatchObject({ jql: 'project = PROJ ORDER BY created', maxResults: 5 });
  });

  it('says when a search finds nothing and rejects a bad limit', async () => {
    const empty = await jira([{ method: 'POST', url: `${SITE}/rest/api/3/search/jql`, reply: { body: { issues: [] } } }], ['search', 'project = NONE']);
    expect(empty.out).toContain('No issues found.');
    const bad = await jira([], ['search', 'x', '--limit', '500']);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('--limit must be');
  });

  it('writes a comment as Atlassian Document Format', async () => {
    const post: Route = { method: 'POST', url: `${SITE}/rest/api/3/issue/PROJ-1/comment`, reply: { status: 201, body: { id: '10001' } } };
    const { code, out, router } = await jira([post], ['comment', 'PROJ-1', '--body', 'Done in abc.\nSecond line\n\n- one\n- two']);
    expect(code).toBe(0);
    expect(out).toContain('Commented on PROJ-1 (comment 10001).');
    expect(sent(router)[0].body).toEqual({
      body: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Done in abc.' }, { type: 'hardBreak' }, { type: 'text', text: 'Second line' }] },
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
            ],
          },
        ],
      },
    });
  });

  it('reads the comment text from a file and refuses an empty one', async () => {
    const file = path.join(tmp, 'comment.txt');
    fs.writeFileSync(file, 'From a file');
    const post: Route = { method: 'POST', url: `${SITE}/rest/api/3/issue/PROJ-1/comment`, reply: { status: 201, body: { id: '7' } } };
    const ok = await jira([post], ['comment', 'PROJ-1', '--body-file', file]);
    expect(sent(ok.router)[0].body).toMatchObject({ body: { content: [{ content: [{ text: 'From a file' }] }] } });
    const empty = await jira([post], ['comment', 'PROJ-1', '--body', '  ']);
    expect(empty.code).toBe(1);
    expect(empty.err).toContain('The text is empty.');
    const none = await jira([post], ['comment', 'PROJ-1']);
    expect(none.err).toContain('exactly one of --body');
    const missing = await jira([post], ['comment', 'PROJ-1', '--body-file', path.join(tmp, 'absent.txt')]);
    expect(missing.err).toContain('Could not read the text');
  });

  it('writes a description as Atlassian Document Format with PUT', async () => {
    const put: Route = { method: 'PUT', url: `${SITE}/rest/api/3/issue/PROJ-1`, reply: { status: 204 } };
    const { code, out, router } = await jira([put], ['describe', 'PROJ-1', '--body', 'Plain description']);
    expect(code).toBe(0);
    expect(out).toContain('Updated the description of PROJ-1.');
    expect(sent(router)[0].body).toEqual({ fields: { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain description' }] }] } } });
  });

  it('lists transitions', async () => {
    const { out } = await jira([transitionsRoute], ['transitions', 'PROJ-1']);
    expect(out).toContain('11  Start review -> In Review');
    expect(out).toContain('31  Finish -> Done');
  });

  it.each([
    ['the target status', 'in review', '11'],
    ['the transition name', 'FINISH', '31'],
  ])('moves an issue by %s', async (_label, wanted, id) => {
    const post: Route = { method: 'POST', url: `${SITE}/rest/api/3/issue/PROJ-1/transitions`, reply: { status: 204 } };
    const { code, out, router } = await jira([transitionsRoute, post], ['transition', 'PROJ-1', ...wanted.split(' ')]);
    expect(code).toBe(0);
    expect(out).toMatch(/PROJ-1 is now "(In Review|Done)"\./);
    expect(router.calls.at(-1)?.body).toEqual({ transition: { id } });
  });

  it('lists what is possible and posts nothing when the status is unknown', async () => {
    const post: Route = { method: 'POST', url: `${SITE}/rest/api/3/issue/PROJ-1/transitions`, reply: { status: 204 } };
    const { code, err, router } = await jira([transitionsRoute, post], ['transition', 'PROJ-1', 'Shipped']);
    expect(code).toBe(1);
    expect(err).toContain('It can move to: In Review, Done.');
    expect(router.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('reports a refusal with its status and a hint', async () => {
    const { code, err } = await jira([{ method: 'GET', url: `${SITE}/rest/api/3/issue/PROJ-9`, reply: { status: 404, body: { errorMessages: ['Issue does not exist'] } } }], ['get', 'PROJ-9']);
    expect(code).toBe(1);
    expect(err).toContain('refused (404)');
    expect(err).toContain('Issue does not exist');
  });
});

describe('lantern-jira scoped tokens', () => {
  const unauthorizedSite: Route = { method: 'GET', url: `${SITE}/rest/api/3/issue/`, reply: { status: 401, body: {} } };
  const tenant: Route = { method: 'GET', url: `${SITE}/_edge/tenant_info`, reply: { body: { cloudId: 'cloud-1' } } };
  const viaGateway: Route = { method: 'GET', url: `${GATEWAY}/rest/api/3/issue/PROJ-1?`, reply: { body: ISSUE } };
  const urls = (router: Router) => router.calls.map((call) => call.url.split('?')[0]);

  it('uses the gateway first and never calls the site for the issue', async () => {
    const { code, out, router } = await jira([tenant, viaGateway, issueRoute], ['get', 'PROJ-1']);
    expect(code).toBe(0);
    expect(out).toContain('PROJ-1: Fix the login redirect');
    expect(out).toContain(`URL: ${SITE}/browse/PROJ-1`);
    expect(urls(router)).toEqual([`${SITE}/_edge/tenant_info`, `${GATEWAY}/rest/api/3/issue/PROJ-1`]);
    expect(router.calls[0].headers.authorization).toBeUndefined();
    expect(router.calls[1].headers.authorization).toBe(BASIC);
  });

  it('falls back to the site when the gateway answers 401', async () => {
    const { code, router } = await jira([tenant, { method: 'GET', url: `${GATEWAY}/rest/api/3/issue/`, reply: { status: 401 } }, issueRoute], ['get', 'PROJ-1']);
    expect(code).toBe(0);
    expect(urls(router)).toEqual([`${SITE}/_edge/tenant_info`, `${GATEWAY}/rest/api/3/issue/PROJ-1`, `${SITE}/rest/api/3/issue/PROJ-1`]);
    expect(router.calls[2].headers.authorization).toBe(BASIC);
  });

  it('uses the site when the cloud id cannot be resolved', async () => {
    const { code, router } = await jira([{ method: 'GET', url: `${SITE}/_edge/tenant_info`, reply: { status: 500 } }, issueRoute], ['get', 'PROJ-1']);
    expect(code).toBe(0);
    expect(urls(router)).toEqual([`${SITE}/_edge/tenant_info`, `${SITE}/rest/api/3/issue/PROJ-1`]);
  });

  it('resolves the cloud id once and keeps the working route for the whole run', async () => {
    const router = createRouter([tenant, viaGateway, { method: 'GET', url: `${GATEWAY}/rest/api/3/issue/PROJ-1/transitions`, reply: { body: TRANSITIONS } }]);
    const cli = await import(pathToFileURL(path.join(SKILLS_ROOT, 'lantern-jira', 'scripts', 'jira-api.mjs')).href);
    const api = cli.createJiraApi({ site: SITE, email: 'dev@example.com', token: TOKEN, fetch: fakeFetch(router), redact: (text: string) => text });
    await api.get('/rest/api/3/issue/PROJ-1');
    await api.get('/rest/api/3/issue/PROJ-1/transitions');
    expect(urls(router)).toEqual([`${SITE}/_edge/tenant_info`, `${GATEWAY}/rest/api/3/issue/PROJ-1`, `${GATEWAY}/rest/api/3/issue/PROJ-1/transitions`]);
  });

  it('reports the 401 and does not loop when the site refuses too', async () => {
    const { code, err, router } = await jira([tenant, { method: 'GET', url: `${GATEWAY}/rest/api/3/issue/`, reply: { status: 401 } }, unauthorizedSite], ['get', 'PROJ-1']);
    expect(code).toBe(1);
    expect(err).toContain('refused (401)');
    expect(router.calls).toHaveLength(3);
  });

  it('asks for English on every call, the cloud id lookup and the fallback included', async () => {
    const { router } = await jira([tenant, { method: 'GET', url: `${GATEWAY}/rest/api/3/issue/`, reply: { status: 401 } }, issueRoute], ['get', 'PROJ-1']);
    expect(router.calls).toHaveLength(3);
    for (const call of router.calls) expect(call.headers['accept-language']).toBe('en');
  });

  describe('a scoped token, whose site answers 404 and gateway answers 200', () => {
    const siteGone = (method: string): Route => ({ method, url: SITE + '/rest/api/3/', reply: { status: 404, body: { errorMessages: ['Issue does not exist or you do not have permission to see it.'] } } });
    const gateway = (method: string, suffix: string, reply: Route['reply']): Route => ({ method, url: `${GATEWAY}/rest/api/3/${suffix}`, reply });

    it('gets an issue', async () => {
      const { code, out } = await jira([tenant, siteGone('GET'), gateway('GET', 'issue/PROJ-1?', { body: ISSUE })], ['get', 'PROJ-1']);
      expect(code).toBe(0);
      expect(out).toContain('PROJ-1: Fix the login redirect');
    });

    it('transitions an issue', async () => {
      const { code, out, router } = await jira(
        [tenant, siteGone('GET'), siteGone('POST'), gateway('GET', 'issue/PROJ-1/transitions', { body: TRANSITIONS }), gateway('POST', 'issue/PROJ-1/transitions', { status: 204 })],
        ['transition', 'PROJ-1', 'Done'],
      );
      expect(code).toBe(0);
      expect(out).toContain('PROJ-1 is now "Done".');
      expect(router.calls.at(-1)?.body).toEqual({ transition: { id: '31' } });
    });

    it('comments on an issue', async () => {
      const { code, out } = await jira([tenant, siteGone('POST'), gateway('POST', 'issue/PROJ-1/comment', { status: 201, body: { id: '10001' } })], ['comment', 'PROJ-1', '--body', 'Done.']);
      expect(code).toBe(0);
      expect(out).toContain('Commented on PROJ-1 (comment 10001).');
    });
  });
});

describe('lantern-jira environment', () => {
  it('names every missing variable once, points at Lantern and sends nothing', async () => {
    const { code, err, out, router } = await jira([issueRoute], ['get', 'PROJ-1'], {});
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err.trim().split('\n')).toHaveLength(1);
    expect(err).toContain('ATLASSIAN_EMAIL, GLOBAL_ATLASSIAN_TOKEN, ATLASSIAN_BASE_URL');
    expect(err).toContain('command palette, Integrations');
    expect(router.calls).toEqual([]);
  });

  it('names only the variable that is missing', async () => {
    const { err } = await jira([], ['get', 'PROJ-1'], { ...ENV, ATLASSIAN_BASE_URL: '  ' });
    expect(err).toContain('Missing ATLASSIAN_BASE_URL.');
  });

  it('refuses a site that is not https and sends nothing', async () => {
    const { code, err, router } = await jira([issueRoute], ['get', 'PROJ-1'], { ...ENV, ATLASSIAN_BASE_URL: 'http://example.atlassian.net' });
    expect(code).toBe(1);
    expect(err).toContain('must be the https URL');
    expect(router.calls).toEqual([]);
  });

  it('shows usage without credentials and rejects unknown commands and options', async () => {
    const help = await jira([], ['help'], {});
    expect(help.code).toBe(0);
    expect(help.out).toContain('transition <KEY> <status name>');
    const unknown = await jira([], ['delete', 'PROJ-1'], {});
    expect(unknown.code).toBe(2);
    const option = await jira([], ['get', 'PROJ-1', '--force'], ENV);
    expect(option.code).toBe(2);
    expect(option.err).toContain('Unknown option --force');
  });
});

describe('plain text to Atlassian Document Format', () => {
  it('round-trips paragraphs, breaks and bullets', async () => {
    const adf = await import(pathToFileURL(path.join(SKILLS_ROOT, 'lantern-jira', 'scripts', 'adf.mjs')).href);
    const text = 'First line\nSecond line\n\n- a\n- b';
    expect(adf.adfToText(adf.textToAdf(text)).trim()).toBe('First line\nSecond line\n- a\n- b');
    expect(adf.textToAdf('').content).toEqual([]);
  });
});

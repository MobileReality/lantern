import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const MOCK_SCOPES = 'read:repository:bitbucket, write:pullrequest:bitbucket';
export const DUMP_PATH = '/__prs';
const LISTEN_HOST = '127.0.0.1';
const ROUTE = /^\/2\.0\/repositories\/([^/]+)\/([^/]+?)(\/pullrequests(?:\/(\d+))?)?\/?$/;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-oauth-scopes': MOCK_SCOPES });
  res.end(JSON.stringify(body));
}

const fail = (res, status, message) => send(res, status, { error: { message: `mock: ${message}` } });

function parseJson(raw) {
  try {
    return { body: JSON.parse(raw || '{}') };
  } catch {
    return { error: true };
  }
}

function listPrs(res, prs, key, query) {
  const source = (query.get('q') ?? '').match(/source\.branch\.name="([^"]+)"/)?.[1];
  const values = [...prs.values()].filter((pr) => pr.key === key && pr.state === 'OPEN' && (!source || pr.source?.branch?.name === source));
  send(res, 200, { values });
}

function createPr(res, prs, key, body) {
  const id = [...prs.values()].filter((pr) => pr.key === key).length + 1;
  const pr = {
    id,
    key,
    state: 'OPEN',
    title: body.title,
    description: body.description ?? '',
    source: body.source,
    destination: body.destination,
    links: { html: { href: `https://bitbucket.org/${key}/pull-requests/${id}` } },
  };
  prs.set(`${key}#${id}`, pr);
  send(res, 201, pr);
}

function updatePr(res, pr, body) {
  if (body.title) pr.title = body.title;
  if (body.description !== undefined) pr.description = body.description;
  send(res, 200, pr);
}

function handle(prs, method, url, raw, res) {
  if (url.pathname === DUMP_PATH && method === 'GET') return send(res, 200, { values: [...prs.values()] });
  const match = url.pathname.match(ROUTE);
  if (!match) return fail(res, 404, 'no route');
  const [, workspace, repo, prPart, id] = match;
  const key = `${workspace}/${repo}`;
  if (!prPart) return send(res, 200, { slug: repo, full_name: key });
  if (!id && method === 'GET') return listPrs(res, prs, key, url.searchParams);
  const parsed = parseJson(raw);
  if (parsed.error) return fail(res, 400, 'invalid JSON body');
  if (!id && method === 'POST') return createPr(res, prs, key, parsed.body);
  const pr = prs.get(`${key}#${id}`);
  if (!pr) return fail(res, 404, 'no such PR');
  if (method === 'GET') return send(res, 200, pr);
  if (method === 'PUT') return updatePr(res, pr, parsed.body);
  return fail(res, 405, 'method not allowed');
}

export function createMockServer() {
  const prs = new Map();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => handle(prs, req.method, new URL(req.url, `http://${LISTEN_HOST}`), raw, res));
  });
  return { server, prs };
}

export function startMock(port = 0) {
  const { server, prs } = createMockServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LISTEN_HOST, () => {
      const close = () => new Promise((done) => server.close(done));
      resolve({ server, prs, port: server.address().port, close });
    });
  });
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (invoked) {
  const { port } = await startMock(Number(process.env.MOCK_BB_PORT ?? 0));
  console.log(`mock-bitbucket listening on ${port}`);
}

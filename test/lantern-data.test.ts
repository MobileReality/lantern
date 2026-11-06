import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../src/main/lantern';
import type { DbSection, FactsSection, RbacSection, StatesSection } from '../src/main/lantern';
import { git } from './helpers/git-repo';

const FIXTURES = path.join(__dirname, 'fixtures');
const PLATFORMS_FIXTURE = path.join(FIXTURES, 'lantern-demo-platforms');
const AI_FIXTURE = path.join(FIXTURES, 'lantern-demo-ai');

let project: string;
let scratch: string[] = [];

function tempProject(fixture?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-lantern-data-'));
  scratch.push(dir);
  if (fixture) fs.cpSync(path.join(fixture, '.lantern'), path.join(dir, '.lantern'), { recursive: true });
  return dir;
}

function fixtureWorld(fixture: string) {
  const dir = tempProject(fixture);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '--', '.lantern']);
  git(dir, ['commit', '-q', '-m', 'fixture']);
  return dir;
}

function write(rel: string, text: string) {
  const file = path.join(project, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

beforeEach(() => {
  vi.stubEnv('LANTERN_LANG', '');
  project = tempProject();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

describe('platforms (demo-platforms)', () => {
  it('counts mapped files per platform and puts the rest in shared', async () => {
    const { platforms, nodes } = await load(fixtureWorld(PLATFORMS_FIXTURE));
    expect(platforms.map((p) => [p.id, p.kind, p.count])).toEqual([
      ['web', 'web', 3],
      ['backend', 'backend', 4],
      ['mobile', 'mobile', 2],
      ['desktop', 'desktop', 2],
      ['infra', 'infra', 2],
      ['watch', 'other', 2],
      ['shared', 'shared', 1],
    ]);
    expect(platforms.reduce((sum, p) => sum + p.count, 0)).toBe(nodes.length);
  });

  it('labels platforms from lang/<code>/platforms.json and falls back per kind', async () => {
    const { platforms } = await load(fixtureWorld(PLATFORMS_FIXTURE));
    expect(platforms.map((p) => p.label)).toEqual(['Dashboard site', 'Readings API', 'Phone app', 'Export tool', 'AWS and CI', 'Smartwatch', 'Shared']);
  });

  it('falls back to the kind name when platforms.json has no label', async () => {
    project = tempProject(PLATFORMS_FIXTURE);
    write('.lantern/lang/en/platforms.json', JSON.stringify({ text: { web: 'Site', watch: 'Smartwatch' } }));
    const { platforms } = await load(project);
    expect(platforms.map((p) => p.label)).toEqual(['Site', 'Backend', 'Mobile', 'Desktop', 'Infrastructure', 'Smartwatch', 'Shared']);
  });

  it('resolves the platform of each file, first matching rule wins', async () => {
    const { nodes } = await load(fixtureWorld(PLATFORMS_FIXTURE));
    const byPath = new Map(nodes.map((n) => [n.path, n.platform]));
    expect(byPath.get('api/src/routes.ts')).toBe('backend');
    expect(byPath.get('infra/main.tf')).toBe('infra');
    expect(byPath.get('.github/workflows/deploy.yml')).toBe('infra');
    expect(byPath.get('watch/Sources/WatchApp.swift')).toBe('watch');
    expect(byPath.get('package.json')).toBe('shared');
  });

  it('recognises role infra', async () => {
    const { nodes } = await load(fixtureWorld(PLATFORMS_FIXTURE));
    expect(nodes.filter((n) => n.role === 'infra').map((n) => n.path).sort()).toEqual(['.github/workflows/deploy.yml', 'infra/main.tf']);
  });

  it('lists no shared entry when no file is left over', async () => {
    project = tempProject(PLATFORMS_FIXTURE);
    write('.lantern/platforms', ['web web web/** package.json', 'backend backend api/**', 'rest other **'].join('\n'));
    const { platforms } = await load(project);
    expect(platforms.map((p) => p.id)).toEqual(['web', 'backend', 'rest']);
    expect(platforms.map((p) => p.count)).toEqual([4, 4, 8]);
  });

  it('lets the first matching rule claim an overlap', async () => {
    project = tempProject(PLATFORMS_FIXTURE);
    write('.lantern/platforms', ['infra infra api/src/routes.ts infra/**', 'backend backend api/**'].join('\n'));
    const { nodes } = await load(project);
    const byPath = new Map(nodes.map((n) => [n.path, n.platform]));
    expect(byPath.get('api/src/routes.ts')).toBe('infra');
    expect(byPath.get('api/src/services/readingService.ts')).toBe('backend');
  });

  it.each([['no platforms file', null], ['one platform', 'web web web/**']])('returns nothing platform-related with %s', async (_name, content) => {
    project = tempProject(PLATFORMS_FIXTURE);
    if (content === null) fs.rmSync(path.join(project, '.lantern', 'platforms'));
    else write('.lantern/platforms', content);
    const map = await load(project);
    expect(map.platforms).toEqual([]);
    expect(map.nodes.every((n) => n.platform === null)).toBe(true);
    expect(map.sections.every((s) => s.platform === null)).toBe(true);
  });

  it('skips a malformed platform line and reports it', async () => {
    project = tempProject(PLATFORMS_FIXTURE);
    write('.lantern/platforms', ['web web web/**', 'backend backend api/**', 'bad nonsense x/**', 'Wrong web y/**', 'noglobs web'].join('\n'));
    const map = await load(project);
    expect(map.platforms.map((p) => p.id)).toEqual(['web', 'backend', 'shared']);
    expect(map.warnings.filter((w) => w.startsWith('.lantern/platforms:'))).toHaveLength(3);
  });

  it('scopes a section to its platform', async () => {
    const { sections } = await load(fixtureWorld(PLATFORMS_FIXTURE));
    expect(sections.map((s) => [s.id, s.platform])).toEqual([['db', 'backend'], ['facts', null]]);
  });
});

describe('sections (demo-platforms)', () => {
  it('reads the db section into entities, fields and owners', async () => {
    const { sections, warnings } = await load(fixtureWorld(PLATFORMS_FIXTURE));
    expect(warnings).toEqual([]);
    const db = sections.find((s): s is DbSection => s.type === 'db');
    expect(db?.title).toBe('Readings store');
    expect(db?.entities).toHaveLength(1);
    expect(db?.entities[0]).toMatchObject({
      id: 'readings',
      kind: 'table',
      origin: 'declared',
      text: 'one row per sample from a watch or phone',
      cites: [{ path: 'infra/main.tf', symbol: 'readings', mapped: true }],
      owners: [{ path: 'api/src/repositories/readingRepository.ts', symbol: null, mapped: true }],
    });
    expect(db?.entities[0].fields.map((f) => [f.name, f.type, f.origin, f.text])).toEqual([
      ['userId', 'string', 'declared', 'partition key'],
      ['bpm', 'number', 'inferred', 'heart rate, absent for step-only samples'],
    ]);
  });

  it('reads the facts section with its title, text and citations', async () => {
    const { sections } = await load(fixtureWorld(PLATFORMS_FIXTURE));
    const facts = sections.find((s): s is FactsSection => s.type === 'facts');
    expect(facts?.title).toBe('Worth knowing');
    expect(facts?.items).toHaveLength(1);
    expect(facts?.items[0].id).toBe('offline-first');
    expect(facts?.items[0].text).toContain('hands samples to the phone');
    expect(facts?.items[0].cites.map((c) => [c.path, c.symbol])).toEqual([
      ['watch/Sources/WatchApp.swift', null],
      ['mobile/src/sync/syncQueue.ts', 'flushQueue'],
    ]);
  });
});

describe('demo-ai', () => {
  it('reads the ai role, purposes and relation labels from lang/en', async () => {
    const map = await load(AI_FIXTURE);
    expect(map.errors).toEqual([]);
    expect(map.nodes).toHaveLength(10);
    expect(map.relations).toHaveLength(21);
    expect(map.nodes.filter((n) => n.role === 'ai')).toHaveLength(5);
    const loop = map.nodes.find((n) => n.path === 'src/ai/agentLoop.ts');
    expect(loop?.purpose).toBe('tool-use loop that answers a question and proposes a triage');
    const llm = map.relations.find((r) => r.from === 'src/ai/agentLoop.ts' && r.symbol === 'complete');
    expect(llm).toMatchObject({ arrow: '=', to: 'src/ai/llmClient.ts', label: 'prompt and tool results in, reply out' });
    expect(map.relations.find((r) => r.ext === 'anthropic-api')?.label).toBe('Messages API');
  });

  it('has no platforms and reports the language', async () => {
    const map = await load(AI_FIXTURE);
    expect(map.platforms).toEqual([]);
    expect(map.language).toEqual({ primary: 'en', code: 'en', available: ['en'], fallbackCount: 0, fallbackKeys: [] });
  });
});

describe('texts and language fallback', () => {
  beforeEach(() => {
    project = tempProject(AI_FIXTURE);
    write(
      '.lantern/lang/pl/src/ai.lantern.json',
      JSON.stringify({ model: 'x', text: { 'agentLoop.ts': 'petla narzedzi', 'llmClient.ts = ext:anthropic-api': 'API wiadomosci', 'ghost.ts': 'no primary text, never shown' } }),
    );
  });

  it('lists the available languages and the primary', async () => {
    const { language } = await load(project);
    expect(language).toMatchObject({ primary: 'en', code: 'en', available: ['en', 'pl'], fallbackCount: 0 });
  });

  it('shows the requested language and falls back per key to the primary', async () => {
    const { nodes, relations, language } = await load(project, 'pl');
    expect(nodes.find((n) => n.path === 'src/ai/agentLoop.ts')?.purpose).toBe('petla narzedzi');
    expect(nodes.find((n) => n.path === 'src/ai/guardrails.ts')?.purpose).toBe('rejects unsafe answers and malformed triage');
    expect(relations.find((r) => r.ext === 'anthropic-api')?.label).toBe('API wiadomosci');
    expect(language.code).toBe('pl');
    expect(language.fallbackKeys).toContain('src/ai/guardrails.ts');
    expect(language.fallbackKeys).toContain('src/ai/agentLoop.ts = src/ai/llmClient.ts#complete');
    expect(language.fallbackKeys).not.toContain('src/ai/agentLoop.ts');
    expect(language.fallbackKeys).not.toContain('src/ai/ghost.ts');
    expect(language.fallbackCount).toBe(language.fallbackKeys.length);
  });

  it('uses the primary language for a language that does not exist', async () => {
    const { language, nodes } = await load(project, 'de');
    expect(language).toMatchObject({ code: 'en', fallbackCount: 0 });
    expect(nodes[0].purpose).not.toBe('');
  });

  it('reports an unreadable language file as a warning and keeps the map', async () => {
    write('.lantern/lang/pl/src/api.lantern.json', '{ not json');
    const map = await load(project, 'pl');
    expect(map.warnings.some((w) => w.includes('lang/pl/src/api.lantern.json: not valid JSON'))).toBe(true);
    expect(map.nodes).toHaveLength(10);
  });

  it('honours LANTERN_LANG as the primary language', async () => {
    vi.stubEnv('LANTERN_LANG', 'pl');
    const { language, nodes } = await load(project);
    expect(language).toMatchObject({ primary: 'pl', code: 'pl' });
    expect(nodes.find((n) => n.path === 'src/ai/agentLoop.ts')?.purpose).toBe('petla narzedzi');
    expect(nodes.find((n) => n.path === 'src/ai/guardrails.ts')?.purpose).toBe('');
  });
});

describe('legacy inline maps', () => {
  beforeEach(() => {
    write(
      '.lantern/map/src.lantern',
      [
        'lantern 1',
        '# src',
        'src/a.ts . service 000000000000 | does a',
        '#feature auth',
        '#see-also src/b.ts | easily confused',
        '#gotcha order matters',
        '  = src/b.ts#run | run it',
        'src/b.ts . util 000000000000 | does b',
      ].join('\n'),
    );
    write('.lantern/features', ['# areas', 'auth | sign in and out'].join('\n'));
  });

  it('takes inline prose as the primary text', async () => {
    const map = await load(project);
    expect(map.errors).toEqual([]);
    expect(map.nodes[0]).toMatchObject({
      purpose: 'does a',
      feature: 'auth',
      seeAlso: ['src/b.ts'],
      seeAlsoNote: 'easily confused',
      gotcha: 'order matters',
    });
    expect(map.nodes[1]).toMatchObject({ purpose: 'does b', feature: null, seeAlso: [], gotcha: null });
    expect(map.relations[0].label).toBe('run it');
    expect(map.features).toEqual([{ id: 'auth', description: 'sign in and out' }]);
    expect(map.language.available).toEqual(['en']);
  });

  it('lets a lang file win over inline prose', async () => {
    write('.lantern/lang/en/src.lantern.json', JSON.stringify({ text: { 'a.ts': 'from lang', 'a.ts gotcha': 'lang gotcha', auth: 'ignored here' } }));
    write('.lantern/lang/en/features.json', JSON.stringify({ text: { auth: 'sign in (lang)' } }));
    const map = await load(project);
    expect(map.nodes[0]).toMatchObject({ purpose: 'from lang', gotcha: 'lang gotcha', seeAlsoNote: 'easily confused' });
    expect(map.features[0].description).toBe('sign in (lang)');
  });
});

describe('record notes in the keyed format', () => {
  it('reads feature, see-also, gotcha and features from lang', async () => {
    write(
      '.lantern/map/src.lantern',
      ['lantern 1', '# src', 'src/a%20b.ts . page 000000000000', '#feature auth', '#see-also src/c.ts', '  > ext:slack-webhook', 'src/c.ts . page 000000000000'].join('\n'),
    );
    write('.lantern/features', 'auth\nbilling\n');
    write(
      '.lantern/lang/en/src.lantern.json',
      JSON.stringify({ text: { 'a%20b.ts': 'a page', 'a%20b.ts gotcha': 'not routed', 'a%20b.ts see-also': 'twin', 'a%20b.ts > ext:slack-webhook': 'message', 'c.ts': 'c page' } }),
    );
    write('.lantern/lang/en/features.json', JSON.stringify({ text: { auth: 'sign in', billing: 'invoices' } }));
    const map = await load(project);
    expect(map.errors).toEqual([]);
    expect(map.nodes[0]).toMatchObject({ path: 'src/a b.ts', purpose: 'a page', gotcha: 'not routed', seeAlso: ['src/c.ts'], seeAlsoNote: 'twin', feature: 'auth' });
    expect(map.relations[0]).toMatchObject({ ext: 'slack-webhook', label: 'message' });
    expect(map.features).toEqual([
      { id: 'auth', description: 'sign in' },
      { id: 'billing', description: 'invoices' },
    ]);
  });
});

describe('rbac and states sections', () => {
  beforeEach(() => {
    write('.lantern/map/src.lantern', ['lantern 1', '# src', 'src/auth.ts . middleware 000000000000', 'src/order.ts . service 000000000000'].join('\n'));
  });

  it('reads an rbac section into roles, resources, cells, sources and guards', async () => {
    write(
      '.lantern/sections/rbac.section',
      [
        'lantern-section 1',
        '# rbac',
        'role admin @ src/auth.ts#isAdmin',
        'role guest @ src/auth.ts',
        'res orders @ src/order.ts',
        'cell admin orders allow @ src/auth.ts',
        'cell guest orders cond @ src/auth.ts#check',
        'source allow-list @ src/auth.ts',
        'guard order-guard @ src/order.ts src/auth.ts#guard',
      ].join('\n'),
    );
    write(
      '.lantern/lang/en/sections/rbac.json',
      JSON.stringify({ text: { title: 'Access', intro: 'browser only', 'role admin': 'staff', 'cell guest orders': 'only own orders', 'guard order-guard': 'checks owner' } }),
    );
    const map = await load(project);
    const rbac = map.sections[0] as RbacSection;
    expect(map.warnings).toEqual([]);
    expect(rbac).toMatchObject({ id: 'rbac', type: 'rbac', title: 'Access', intro: 'browser only' });
    expect(rbac.roles.map((r) => [r.id, r.text])).toEqual([['admin', 'staff'], ['guest', '']]);
    expect(rbac.resources.map((r) => r.id)).toEqual(['orders']);
    expect(rbac.cells.map((c) => [c.role, c.resource, c.access, c.text])).toEqual([
      ['admin', 'orders', 'allow', ''],
      ['guest', 'orders', 'cond', 'only own orders'],
    ]);
    expect(rbac.sources.map((s) => s.id)).toEqual(['allow-list']);
    expect(rbac.guards[0].cites.map((c) => c.symbol)).toEqual([null, 'guard']);
  });

  it('reads a states section into machines, states and transitions', async () => {
    write(
      '.lantern/sections/states.section',
      [
        'lantern-section 1',
        '# states',
        'machine order @ src/order.ts',
        'state order open initial @ src/order.ts',
        'state order closed terminal @ src/order.ts',
        'tr order open closed @ src/order.ts#close',
      ].join('\n'),
    );
    write('.lantern/lang/en/sections/states.json', JSON.stringify({ text: { 'machine order': 'an order', 'tr order open closed': 'customer pays' } }));
    const states = (await load(project)).sections[0] as StatesSection;
    expect(states.machines).toHaveLength(1);
    expect(states.machines[0].text).toBe('an order');
    expect(states.machines[0].states.map((s) => [s.id, s.initial, s.terminal])).toEqual([
      ['open', true, false],
      ['closed', false, true],
    ]);
    expect(states.machines[0].transitions).toEqual([{ from: 'open', to: 'closed', text: 'customer pays', cites: [{ path: 'src/order.ts', symbol: 'close', mapped: true }] }]);
  });

  it('orders sections by type and keeps relations between db entities', async () => {
    write(
      '.lantern/sections/db.section',
      ['lantern-section 1', '# db', 'entity user collection inferred @ src/order.ts', 'entity order collection inferred @ src/order.ts', 'rel order userId ref user @ src/order.ts'].join('\n'),
    );
    write('.lantern/sections/facts.section', ['lantern-section 1', '# facts', 'item note-one @ src/auth.ts'].join('\n'));
    write('.lantern/sections/rbac.section', ['lantern-section 1', '# rbac', 'role r @ src/auth.ts'].join('\n'));
    const { sections } = await load(project);
    expect(sections.map((s) => s.type)).toEqual(['rbac', 'db', 'facts']);
    const db = sections[1] as DbSection;
    expect(db.entities.find((e) => e.id === 'order')?.relations).toMatchObject([{ field: 'userId', kind: 'ref', target: 'user' }]);
  });
});

describe('malformed sections', () => {
  beforeEach(() => {
    write('.lantern/map/src.lantern', ['lantern 1', '# src', 'src/auth.ts . middleware 000000000000'].join('\n'));
  });

  it('skips bad items, keeps the good ones and warns', async () => {
    write(
      '.lantern/sections/rbac.section',
      [
        'lantern-section 1',
        '# rbac',
        'role admin @ src/auth.ts',
        'role nocite',
        'role bad!id @ src/auth.ts',
        'bogus thing @ src/auth.ts',
        'res area @ src/auth.ts',
        'cell ghost area allow @ src/auth.ts',
        'cell admin area maybe @ src/auth.ts',
        'cell admin area allow @ src/auth.ts',
        'cell admin area deny @ src/auth.ts',
        'role missing @ src/gone.ts',
      ].join('\n'),
    );
    const map = await load(project);
    const rbac = map.sections[0] as RbacSection;
    expect(rbac.roles.map((r) => r.id)).toEqual(['admin', 'missing']);
    expect(rbac.cells).toHaveLength(1);
    expect(rbac.cells[0].access).toBe('allow');
    expect(rbac.roles[1].cites[0].mapped).toBe(false);
    const text = map.warnings.join('\n');
    expect(text).toContain('rbac.section:4: "role" cites no file');
    expect(text).toContain('bad!id');
    expect(text).toContain('"bogus" is not an item');
    expect(text).toContain('role "ghost" is not a declared role');
    expect(text).toContain('access "maybe"');
    expect(text).toContain('duplicate "cell admin area"');
    expect(text).toContain('cites src/gone.ts, which is not a mapped file');
  });

  it('drops a section with an unknown type or no header and still loads the map', async () => {
    write('.lantern/sections/weird.section', ['lantern-section 1', '# nonsense', 'x y @ src/auth.ts'].join('\n'));
    write('.lantern/sections/empty.section', '');
    write('.lantern/sections/Bad_Name.section', ['lantern-section 1', '# facts', 'item a @ src/auth.ts'].join('\n'));
    write('.lantern/sections/ok.section', ['lantern-section 1', '# facts', 'item a @ src/auth.ts'].join('\n'));
    const map = await load(project);
    expect(map.exists).toBe(true);
    expect(map.nodes).toHaveLength(1);
    expect(map.sections.map((s) => s.id)).toEqual(['ok']);
    const text = map.warnings.join('\n');
    expect(text).toContain('unknown section type "nonsense"');
    expect(text).toContain('empty.section');
    expect(text).toContain('section id "Bad_Name"');
  });

  it('ignores a section scoped to an undeclared platform scope', async () => {
    write('.lantern/platforms', ['web web src/**', 'api backend api/**'].join('\n'));
    write('.lantern/sections/facts.section', ['lantern-section 1', '# facts', '#platform nowhere', 'item a @ src/auth.ts'].join('\n'));
    const map = await load(project);
    expect(map.sections[0].platform).toBeNull();
    expect(map.warnings.join('\n')).toContain('#platform "nowhere" is not a declared platform');
  });
});

const REFERENCE = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts');

describe.skipIf(!fs.existsSync(path.join(REFERENCE, 'lib.mjs')))('parity with the reference scripts', () => {
  async function reference() {
    const lib = await import(pathToFileURL(path.join(REFERENCE, 'lib.mjs')).href);
    const platforms = await import(pathToFileURL(path.join(REFERENCE, 'platforms.mjs')).href);
    const texts = await import(pathToFileURL(path.join(REFERENCE, 'texts.mjs')).href);
    const sections = await import(pathToFileURL(path.join(REFERENCE, 'sections.mjs')).href);
    return { lib, platforms, texts, sections };
  }

  it.each([
    ['demo-platforms', PLATFORMS_FIXTURE],
    ['demo-ai', AI_FIXTURE],
  ])('agrees on nodes, relations, platforms, texts and sections for %s', async (_name, root) => {
    const ref = await reference();
    const { records, errors } = ref.lib.loadMap(root);
    const map = await load(root);
    expect(errors).toEqual([]);
    expect(map.nodes.length).toBe(records.length);
    expect(map.relations.length).toBe(records.reduce((n: number, r: { relations: unknown[] }) => n + r.relations.length, 0));
    expect(map.nodes.map((n) => n.path)).toEqual(records.map((r: { path: string }) => r.path));

    const { platforms: rules } = ref.platforms.loadPlatforms(root);
    const tabbed = rules !== null && rules.length >= 2;
    for (const node of map.nodes) expect(node.platform).toBe(tabbed ? ref.platforms.resolvePlatform(rules, node.path) : null);
    if (tabbed) {
      const expected = new Map<string, number>();
      for (const r of records) expected.set(ref.platforms.resolvePlatform(rules, r.path), (expected.get(ref.platforms.resolvePlatform(rules, r.path)) ?? 0) + 1);
      expect(Object.fromEntries(map.platforms.map((p) => [p.id, p.count]))).toEqual(Object.fromEntries(expected));
    } else {
      expect(map.platforms).toEqual([]);
    }

    const langs = ref.texts.loadLangs(root);
    const slots = ref.texts.textSlots(records, null, langs, 'en');
    const byKey = new Map<string, string>(slots.filter((s: { primary: string | null }) => s.primary).map((s: { projectKey: string; primary: string }) => [s.projectKey, s.primary]));
    for (const node of map.nodes) expect(node.purpose).toBe(byKey.get(node.path) ?? '');
    for (const rel of map.relations) {
      const from = records.find((r: { path: string }) => r.path === rel.from);
      const raw = from.relations.find((x: { arrow: string; path: string | null; external: string | null; symbol: string | null }) => x.arrow === rel.arrow && x.path === rel.to && x.external === rel.ext && x.symbol === rel.symbol);
      expect(rel.label).toBe(byKey.get(`${rel.from} ${rel.arrow} ${raw.token}`) ?? '');
    }

    const { sections } = ref.sections.loadSections(root);
    expect(map.sections.map((s) => [s.id, s.type, tabbed ? s.platform : null])).toEqual(sections.map((s: { id: string; type: string; platform: string | null }) => [s.id, s.type, tabbed ? s.platform : null]));
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_GITIGNORE, writeFiles } from './fixtures.mjs';
import { treeText } from './areas-fixtures.mjs';
import { OVERFLOW_FEATURE, OVERFLOW_LINES, PLATFORM_KINDS, SHOP, SMALL_FEATURES, SMALL_PARTS, STUDIO } from './lantern-areas-specs.mjs';
import { writeMapRecords } from './vocab-fixtures.mjs';

export const PROJECT_NAMES = { good: 'shop-good', trap: 'shop-trap', small: 'shop-small', retag: 'studio-old-map', overflow: 'shop-overflow' };
export const NEW_FEATURE = OVERFLOW_FEATURE.id;
export const SCRATCH_DIR = '.ai/tmp/areas';
export const ANSWERS_FILE = `${SCRATCH_DIR}/answers.json`;

const WEB_ROLES = ['page', 'component', 'component', 'hook', 'state'];
const BACKEND_ROLES = ['route', 'handler', 'service', 'repository', 'model'];
const MOBILE_ROLES = ['page', 'component'];
const ROLES = { web: WEB_ROLES, backend: BACKEND_ROLES, mobile: MOBILE_ROLES };
const PLUMBING = {
  web: [['entry', 'entry'], ['config', 'config'], ['layout', 'style']],
  backend: [['entry', 'entry'], ['config', 'config'], ['database', 'infra'], ['migrations/001-init', 'migration']],
  mobile: [['entry', 'entry'], ['config', 'config']],
};
const DECOY_LINES = 3;
const WITHIN_LINES = { good: 2, trap: 1 };
const HUB_LINES = 1;
const STAFF_FILES = [
  { path: 'api/staff-rota/part-01.mjs', role: 'route', imports: 'api/sign-in/part-01.mjs' },
  { path: 'api/staff-rota/part-02.mjs', role: 'service' },
  { path: 'api/staff-rota/part-03.mjs', role: 'repository' },
  { path: 'storefront/staff-rota/part-01.mjs', role: 'page' },
  { path: 'storefront/staff-rota/part-02.mjs', role: 'component' },
];

const partName = (n) => `part-${String(n).padStart(2, '0')}.mjs`;
const kindOf = (platform) => PLATFORM_KINDS[platform];
const camel = (rel) => rel.replace(/\.mjs$/, '').replace(/[^a-z0-9]+(\w)/g, (_, c) => c.toUpperCase());
const sourceOf = (rel, imports) => `${imports ? `import { ${camel(imports)} } from '../${imports.split('/').slice(1).join('/')}';\n\n` : ''}export function ${camel(rel)}() {\n  return '${rel}'${imports ? ` + ${camel(imports)}()` : ''};\n}\n`;
const unique = (list) => [...new Set(list)];
const pairsOf = (ids) => ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => [a, b]));

function featureRecords(spec, features, parts) {
  return features.flatMap((f) => spec.platforms.filter((p) => kindOf(p) !== 'mobile' || f.onApp).flatMap((platform) => {
    const roles = ROLES[kindOf(platform)];
    return Array.from({ length: parts[platform] }, (_, i) => ({ path: `${platform}/${f.id}/${partName(i + 1)}`, role: roles[i % roles.length], feature: f.id, purpose: `Handles part ${i + 1} of ${f.id} on the ${platform}`, relations: [] }));
  }));
}

function plumbingRecords(spec) {
  return spec.platforms.flatMap((platform) => PLUMBING[kindOf(platform)].map(([name, role]) => ({ path: `${platform}/shared/${name}.mjs`, role, purpose: `Shared ${role} of the ${platform}`, relations: [] })));
}

function edgeList(spec, features, variant) {
  const ids = features.map((f) => f.id);
  const within = unique(features.map((f) => f.fn)).flatMap((fn) => pairsOf(features.filter((f) => f.fn === fn).map((f) => f.id)).map(([a, b]) => [a, b, WITHIN_LINES[variant]]));
  const cross = spec.crossLines.filter(([a, b]) => ids.includes(a) && ids.includes(b));
  if (variant === 'trap') return [...within, ...(spec.decoyGroups ?? []).flatMap((group) => pairsOf(group).map(([a, b]) => [a, b, DECOY_LINES]))];
  const hub = spec.hubFeature && ids.includes(spec.hubFeature) ? ids.filter((id) => id !== spec.hubFeature).map((id) => [id, spec.hubFeature, HUB_LINES]) : [];
  return [...within, ...cross, ...hub];
}

function addEdges(records, backend, edges) {
  const byPath = new Map(records.map((r) => [r.path, r]));
  for (const [from, to, lines] of edges) {
    for (let i = 1; i <= lines; i++) {
      const source = byPath.get(`${backend}/${from}/${partName(i)}`);
      const target = `${backend}/${to}/${partName(i)}`;
      if (source && byPath.has(target)) source.relations.push(`> ${target}`);
    }
  }
}

function sourcesOf(records, extra = []) {
  return Object.fromEntries([...records.map((r) => [r.path, sourceOf(r.path)]), ...extra.map((f) => [f.path, sourceOf(f.path, f.imports)])]);
}

const write = (root, rel, text) => {
  const file = path.join(root, '.lantern', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const textJson = (text) => `${JSON.stringify({ text }, null, 1)}\n`;

function writeLanternFiles(root, spec, features) {
  write(root, 'platforms', `# <id> <kind> <glob>...\n${spec.platforms.map((p) => `${p} ${kindOf(p)} ${p}/**`).join('\n')}\n`);
  write(root, 'features', `${features.map((f) => f.id).join('\n')}\n`);
  write(root, 'lang/en/features.json', textJson(Object.fromEntries(features.map((f) => [f.id, f.text]))));
  write(root, 'systems', '# outside systems\n');
  write(root, 'lang/en/systems.json', textJson({}));
}

export function writeTree(root, tree, purposes) {
  write(root, 'areas', treeText(tree));
  write(root, 'lang/en/areas.json', textJson(Object.fromEntries(Object.keys(tree).map((area) => [area, purposes[area]]))));
}

function projectFiles(name, records, extra) {
  const manifest = `{\n  "name": "${name}",\n  "private": true,\n  "type": "module"\n}\n`;
  return { ...sourcesOf(records, extra), 'package.json': manifest, '.gitignore': `${FIXTURE_GITIGNORE.join('\n')}\n` };
}

function buildProject(root, { name, spec, features = spec.features, parts = spec.parts, variant = 'good', extraSources = [], withTree = null }) {
  fs.mkdirSync(root, { recursive: true });
  const records = [...featureRecords(spec, features, parts), ...plumbingRecords(spec)];
  addEdges(records, spec.platforms[1], edgeList(spec, features, variant));
  writeFiles(root, projectFiles(name, records, extraSources));
  writeMapRecords(root, [{ path: 'package.json', role: 'config', purpose: `Package manifest of ${name}` }, ...records]);
  writeLanternFiles(root, spec, features);
  if (withTree) writeTree(root, withTree.tree, withTree.purposes);
}

export const createGoodProject = (root) => buildProject(root, { name: PROJECT_NAMES.good, spec: SHOP });
export const createTrapProject = (root) => buildProject(root, { name: PROJECT_NAMES.trap, spec: SHOP, variant: 'trap' });
export const createRetagProject = (root) => buildProject(root, { name: PROJECT_NAMES.retag, spec: STUDIO });
export const createSmallProject = (root) => buildProject(root, { name: PROJECT_NAMES.small, spec: SHOP, features: SHOP.features.filter((f) => SMALL_FEATURES.includes(f.id)), parts: SMALL_PARTS });

export function createOverflowProject(root) {
  buildProject(root, { name: PROJECT_NAMES.overflow, spec: SHOP, extraSources: STAFF_FILES, withTree: { tree: SHOP.sevenTree, purposes: SHOP.sevenPurposes } });
}

export function mapNewFeature(root) {
  const features = [...SHOP.features, OVERFLOW_FEATURE];
  const staff = STAFF_FILES.map((f) => ({ path: f.path, role: f.role, feature: NEW_FEATURE, purpose: `Handles one step of ${NEW_FEATURE}`, relations: f.imports ? OVERFLOW_LINES.map(([, to]) => `> ${path.posix.join('api', to, 'part-01.mjs')}`) : [] }));
  const records = [...featureRecords(SHOP, SHOP.features, SHOP.parts), ...plumbingRecords(SHOP), ...staff];
  addEdges(records, SHOP.platforms[1], edgeList(SHOP, SHOP.features, 'good'));
  writeMapRecords(root, [{ path: 'package.json', role: 'config', purpose: `Package manifest of ${PROJECT_NAMES.overflow}` }, ...records]);
  writeLanternFiles(root, SHOP, features);
}

export const FIXTURES = {
  good: createGoodProject,
  trap: createTrapProject,
  small: createSmallProject,
  retag: createRetagProject,
  overflow: createOverflowProject,
};

export const projectKeyOf = (name) => Object.keys(PROJECT_NAMES).find((key) => PROJECT_NAMES[key] === name) ?? null;

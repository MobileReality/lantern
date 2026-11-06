import type { LanternPlatform } from '../../main/lantern';

interface Layer {
  id: string;
  name: string;
  cap: string;
  roles: string[];
}

type Kind = LanternPlatform['kind'];

const BASE: Layer[] = [
  { id: 'skills', name: 'Skills', cap: 'instructions agents follow', roles: ['skill'] },
  { id: 'edge', name: 'Entry points', cap: 'where input arrives', roles: ['entry', 'route', 'middleware', 'handler'] },
  { id: 'presentation', name: 'Presentation', cap: 'what the user sees', roles: ['page', 'component', 'hook', 'state', 'style'] },
  { id: 'domain', name: 'Domain', cap: 'what decides', roles: ['service', 'model', 'schema', 'pure'] },
  { id: 'ai', name: 'AI', cap: 'what a model produces', roles: ['ai'] },
  { id: 'data', name: 'Data', cap: 'what fetches and stores', roles: ['repository', 'gateway'] },
  { id: 'infra', name: 'Infrastructure', cap: 'resources, images, pipelines', roles: ['infra'] },
  { id: 'support', name: 'Support', cap: 'config, tests, helpers', roles: ['config', 'util', 'test', 'script', 'migration', 'other'] },
  { id: 'system', name: 'Outside', cap: 'systems the code talks to', roles: [] },
];

const HIDES: Partial<Record<Kind, string[]>> = {
  backend: ['presentation'],
  infra: ['presentation', 'ai'],
};

const TEXTS: Partial<Record<Kind, Record<string, [string, string]>>> = {
  backend: {
    edge: ['Endpoints', 'requests and jobs arrive'],
    domain: ['Business logic', 'rules and use cases'],
    data: ['Data & services', 'storage, outside services'],
  },
  mobile: {
    edge: ['App shell', 'start and navigation'],
    presentation: ['Screens', 'screens and view state'],
  },
  desktop: {
    edge: ['Main process', 'windows, IPC, native'],
    presentation: ['Renderer', 'UI in the windows'],
  },
  infra: {
    infra: ['Infra & pipelines', 'cloud, manifests, CI/CD'],
    support: ['Tooling', 'scripts, settings, tests'],
  },
};

interface Profile {
  layers: Layer[];
  layerOf(role: string): Layer;
}

const cache = new Map<string, Profile>();

function buildProfile(kind: Kind | '', tabbed: boolean): Profile {
  const hidden = new Set(kind ? (HIDES[kind] ?? []) : []);
  const texts = kind ? (TEXTS[kind] ?? {}) : {};
  const support = BASE.find((l) => l.id === 'support') as Layer;
  const layers: Layer[] = [];
  const byRole = new Map<string, Layer>();
  for (const base of BASE) {
    if (hidden.has(base.id) || (base.id === 'infra' && !tabbed)) continue;
    const [name, cap] = texts[base.id] ?? [base.name, base.cap];
    layers.push({ ...base, name, cap, roles: [...base.roles] });
  }
  const layerSupport = layers.find((l) => l.id === support.id) as Layer;
  for (const base of BASE) {
    const shown = layers.find((l) => l.id === base.id);
    for (const role of base.roles) byRole.set(role, shown ?? layerSupport);
  }
  for (const base of BASE) {
    if (!layers.some((l) => l.id === base.id)) layerSupport.roles = [...layerSupport.roles, ...base.roles];
  }
  return { layers, layerOf: (role) => byRole.get(role) ?? layerSupport };
}

function profileFor(kind: Kind | '', tabbed: boolean): Profile {
  const key = `${tabbed ? 'p' : 'n'}:${kind}`;
  let p = cache.get(key);
  if (!p) {
    p = buildProfile(kind, tabbed);
    cache.set(key, p);
  }
  return p;
}

export { profileFor };
export type { Layer, Profile };

import fs from 'node:fs';
import path from 'node:path';
import { decodePath } from './lantern-parse';
import type { LangStore } from './lantern-texts';
import type {
  DbEntity,
  DbSection,
  FactsSection,
  LanternCite,
  LanternSection,
  RbacEntry,
  RbacSection,
  StateMachine,
  StatesSection,
} from './lantern-types';

const SECTIONS_DIR = '.lantern/sections';
const SECTION_HEADER = 'lantern-section 1';
const SECTION_EXT = '.section';
const SECTION_ID = /^[a-z][a-z0-9-]*$/;
const TOKEN = /^[A-Za-z0-9_$][\w$.:-]*$/;
const TYPE_TOKEN = /^[^\s@]+$/;
const PLATFORM_LINE = /^#platform[ \t]+(\S+)[ \t]*$/;
const TYPE_ORDER = ['rbac', 'states', 'db', 'facts'];

interface ItemSpec {
  args: string[];
  key?: string[];
  flags?: string[];
  enums?: Record<string, string[]>;
  refs?: Record<string, string>;
  stateRefs?: string[];
}

const ORIGINS = ['declared', 'inferred'];

const SCHEMA: Record<string, Record<string, ItemSpec>> = {
  rbac: {
    role: { args: ['role'] },
    res: { args: ['res'] },
    cell: { args: ['role', 'res', 'access'], key: ['role', 'res'], enums: { access: ['allow', 'deny', 'cond'] }, refs: { role: 'role', res: 'res' } },
    source: { args: ['id'] },
    guard: { args: ['id'] },
  },
  states: {
    machine: { args: ['machine'] },
    state: { args: ['machine', 'state'], flags: ['initial', 'terminal'], refs: { machine: 'machine' } },
    tr: { args: ['machine', 'from', 'to'], refs: { machine: 'machine' }, stateRefs: ['from', 'to'] },
  },
  db: {
    entity: { args: ['entity', 'kind', 'origin'], key: ['entity'], enums: { kind: ['table', 'collection', 'view', 'document', 'other'], origin: ORIGINS } },
    field: { args: ['entity', 'field', 'type', 'origin'], key: ['entity', 'field'], enums: { origin: ORIGINS }, refs: { entity: 'entity' } },
    rel: { args: ['entity', 'field', 'kind', 'target'], key: ['entity', 'field', 'target'], enums: { kind: ['ref', 'fk', 'embed'] }, refs: { entity: 'entity', target: 'entity' } },
    own: { args: ['entity'], refs: { entity: 'entity' } },
  },
  facts: {
    item: { args: ['id'] },
  },
};

const DECLARING_KINDS = new Set(['role', 'res', 'machine', 'entity']);

interface Item {
  kind: string;
  args: Record<string, string>;
  flags: string[];
  cites: { token: string; path: string; symbol: string | null }[];
  key: string;
  where: string;
}

interface ParsedSection {
  id: string;
  file: string;
  type: string;
  platform: string | null;
  items: Item[];
}

function parseCite(token: string) {
  const hash = token.indexOf('#');
  return { token, path: decodePath(hash === -1 ? token : token.slice(0, hash)), symbol: hash === -1 ? null : token.slice(hash + 1) || null };
}

function parseItem(spec: ItemSpec, kind: string, tokens: string[], where: string, warnings: string[]): Item | null {
  const at = tokens.indexOf('@');
  const head = at === -1 ? tokens : tokens.slice(0, at);
  const citeTokens = at === -1 ? [] : tokens.slice(at + 1);
  const flags = spec.flags ?? [];
  const positional = head.slice(0, spec.args.length);
  const extra = head.slice(spec.args.length);
  if (positional.length < spec.args.length || (extra.length && !flags.length)) {
    warnings.push(`${where}: "${kind}" takes ${spec.args.map((a) => `<${a}>`).join(' ')}${flags.length ? ` [${flags.join('] [')}]` : ''} @ <path[#symbol]>...; item skipped`);
    return null;
  }
  const args: Record<string, string> = {};
  spec.args.forEach((name, i) => {
    args[name] = positional[i];
  });
  for (const [name, value] of Object.entries(args)) {
    const allowed = spec.enums?.[name];
    const valid = allowed ? allowed.includes(value) : (name === 'type' ? TYPE_TOKEN : TOKEN).test(value);
    if (!valid) {
      warnings.push(`${where}: ${name} "${value}" is not valid; item skipped`);
      return null;
    }
  }
  const unknownFlag = extra.find((f) => !flags.includes(f));
  if (unknownFlag) {
    warnings.push(`${where}: unknown flag "${unknownFlag}"; item skipped`);
    return null;
  }
  if (!citeTokens.length) {
    warnings.push(`${where}: "${kind}" cites no file; item skipped`);
    return null;
  }
  const keyArgs = (spec.key ?? spec.args).map((name) => args[name]);
  return { kind, args, flags: extra, cites: citeTokens.map(parseCite), key: `${kind} ${keyArgs.join(' ')}`, where };
}

function parseSection(text: string, file: string, warnings: string[]): ParsedSection | null {
  const id = path.basename(file, SECTION_EXT);
  if (!SECTION_ID.test(id)) {
    warnings.push(`${file}: section id "${id}" must be lowercase kebab-case; section skipped`);
    return null;
  }
  const items: Item[] = [];
  let sawHeader = false;
  let type: string | null = null;
  let platform: string | null = null;
  text.split(/\r?\n/).forEach((line, index) => {
    const where = `${file}:${index + 1}`;
    if (!line.trim()) return;
    if (!sawHeader) {
      if (line.trim() !== SECTION_HEADER) warnings.push(`${where}: first line must be "${SECTION_HEADER}"`);
      sawHeader = true;
      return;
    }
    if (line.startsWith('#')) {
      if (type === null) {
        type = line.slice(1).trim();
        if (!Object.hasOwn(SCHEMA, type)) warnings.push(`${where}: unknown section type "${type}"; section skipped`);
        return;
      }
      const scope = PLATFORM_LINE.exec(line);
      if (scope) platform ??= scope[1];
      return;
    }
    if (type === null) {
      warnings.push(`${where}: item before the "# <type>" line; item skipped`);
      return;
    }
    const schema = SCHEMA[type];
    if (!schema) return;
    const tokens = line.trim().split(/\s+/);
    const spec = Object.hasOwn(schema, tokens[0]) ? schema[tokens[0]] : undefined;
    if (!spec) {
      warnings.push(`${where}: "${tokens[0]}" is not an item of a ${type} section; item skipped`);
      return;
    }
    const item = parseItem(spec, tokens[0], tokens.slice(1), where, warnings);
    if (item) items.push(item);
  });
  if (!sawHeader || type === null) {
    warnings.push(`${file}: no "# <type>" line; section skipped`);
    return null;
  }
  if (!Object.hasOwn(SCHEMA, type)) return null;
  return { id, file, type, platform, items };
}

function withoutDuplicates(items: Item[], warnings: string[]): Item[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) {
      warnings.push(`${item.where}: duplicate "${item.key}"; item skipped`);
      return false;
    }
    seen.add(item.key);
    return true;
  });
}

function withResolvedRefs(type: string, items: Item[], warnings: string[]): Item[] {
  const schema = SCHEMA[type];
  const declared = new Map<string, Set<string>>();
  const statesOf = new Map<string, Set<string>>();
  for (const item of items) {
    if (DECLARING_KINDS.has(item.kind)) {
      const set = declared.get(item.kind) ?? new Set<string>();
      set.add(item.args[schema[item.kind].args[0]]);
      declared.set(item.kind, set);
    }
    if (item.kind === 'state') {
      const set = statesOf.get(item.args.machine) ?? new Set<string>();
      set.add(item.args.state);
      statesOf.set(item.args.machine, set);
    }
  }
  return items.filter((item) => {
    const spec = schema[item.kind];
    for (const [arg, kind] of Object.entries(spec.refs ?? {})) {
      if (!declared.get(kind)?.has(item.args[arg])) {
        warnings.push(`${item.where}: ${arg} "${item.args[arg]}" is not a declared ${kind}; item skipped`);
        return false;
      }
    }
    for (const arg of spec.stateRefs ?? []) {
      if (!statesOf.get(item.args.machine)?.has(item.args[arg])) {
        warnings.push(`${item.where}: ${arg} "${item.args[arg]}" is not a declared state of ${item.args.machine}; item skipped`);
        return false;
      }
    }
    return true;
  });
}

interface BuildContext {
  section: ParsedSection;
  store: LangStore;
  mapped: Set<string>;
  warnings: string[];
}

function textOf(ctx: BuildContext, key: string) {
  return ctx.store.text(`sections/${ctx.section.id}.json`, key, `section ${ctx.section.id} ${key}`);
}

function citesOf(ctx: BuildContext, item: Item): LanternCite[] {
  return item.cites.map((c) => {
    const mapped = ctx.mapped.has(c.path);
    if (!mapped) ctx.warnings.push(`${item.where}: cites ${c.path}, which is not a mapped file`);
    return { path: c.path, symbol: c.symbol, mapped };
  });
}

function buildRbac(ctx: BuildContext, items: Item[], base: Omit<RbacSection, 'type' | 'roles' | 'resources' | 'cells' | 'sources' | 'guards'>): RbacSection {
  const entry = (item: Item): RbacEntry => ({ id: item.args[Object.keys(item.args)[0]], text: textOf(ctx, item.key), cites: citesOf(ctx, item) });
  const ofKind = (kind: string) => items.filter((i) => i.kind === kind);
  return {
    ...base,
    type: 'rbac',
    roles: ofKind('role').map(entry),
    resources: ofKind('res').map(entry),
    cells: ofKind('cell').map((i) => ({
      role: i.args.role,
      resource: i.args.res,
      access: i.args.access as 'allow' | 'deny' | 'cond',
      text: textOf(ctx, i.key),
      cites: citesOf(ctx, i),
    })),
    sources: ofKind('source').map(entry),
    guards: ofKind('guard').map(entry),
  };
}

function buildStates(ctx: BuildContext, items: Item[], base: Omit<StatesSection, 'type' | 'machines'>): StatesSection {
  const machines: StateMachine[] = items
    .filter((i) => i.kind === 'machine')
    .map((m) => ({
      id: m.args.machine,
      text: textOf(ctx, m.key),
      cites: citesOf(ctx, m),
      states: items
        .filter((i) => i.kind === 'state' && i.args.machine === m.args.machine)
        .map((s) => ({
          id: s.args.state,
          text: textOf(ctx, s.key),
          initial: s.flags.includes('initial'),
          terminal: s.flags.includes('terminal'),
          cites: citesOf(ctx, s),
        })),
      transitions: items
        .filter((i) => i.kind === 'tr' && i.args.machine === m.args.machine)
        .map((t) => ({ from: t.args.from, to: t.args.to, text: textOf(ctx, t.key), cites: citesOf(ctx, t) })),
    }));
  return { ...base, type: 'states', machines };
}

function buildDb(ctx: BuildContext, items: Item[], base: Omit<DbSection, 'type' | 'entities'>): DbSection {
  const entities: DbEntity[] = items
    .filter((i) => i.kind === 'entity')
    .map((e) => {
      const mine = (kind: string) => items.filter((i) => i.kind === kind && i.args.entity === e.args.entity);
      return {
        id: e.args.entity,
        kind: e.args.kind as DbEntity['kind'],
        origin: e.args.origin as DbEntity['origin'],
        text: textOf(ctx, e.key),
        cites: citesOf(ctx, e),
        owners: mine('own').flatMap((o) => citesOf(ctx, o)),
        fields: mine('field').map((f) => ({
          name: f.args.field,
          type: f.args.type,
          origin: f.args.origin as DbEntity['origin'],
          text: textOf(ctx, f.key),
          cites: citesOf(ctx, f),
        })),
        relations: mine('rel').map((r) => ({
          field: r.args.field,
          kind: r.args.kind as 'ref' | 'fk' | 'embed',
          target: r.args.target,
          text: textOf(ctx, r.key),
          cites: citesOf(ctx, r),
        })),
      };
    });
  return { ...base, type: 'db', entities };
}

function buildFacts(ctx: BuildContext, items: Item[], base: Omit<FactsSection, 'type' | 'items'>): FactsSection {
  return {
    ...base,
    type: 'facts',
    items: items.map((i) => ({ id: i.args.id, text: textOf(ctx, i.key), note: textOf(ctx, `${i.key} note`), cites: citesOf(ctx, i) })),
  };
}

function buildSection(ctx: BuildContext, platformIds: string[] | null): LanternSection | null {
  const { section, warnings } = ctx;
  const items = withResolvedRefs(section.type, withoutDuplicates(section.items, warnings), warnings);
  let platform: string | null = null;
  if (platformIds && section.platform) {
    if (platformIds.includes(section.platform)) platform = section.platform;
    else warnings.push(`${section.file}: #platform "${section.platform}" is not a declared platform; shown for all`);
  }
  const base = { id: section.id, file: section.file, platform, title: textOf(ctx, 'title') || null, intro: textOf(ctx, 'intro') || null };
  if (section.type === 'rbac') return buildRbac(ctx, items, base);
  if (section.type === 'states') return buildStates(ctx, items, base);
  if (section.type === 'db') return buildDb(ctx, items, base);
  return buildFacts(ctx, items, base);
}

async function loadSections(root: string, store: LangStore, mapped: Set<string>, platformIds: string[] | null, warnings: string[]): Promise<LanternSection[]> {
  let names: string[];
  try {
    const entries = await fs.promises.readdir(path.join(root, SECTIONS_DIR), { withFileTypes: true });
    names = entries.filter((e) => e.isFile() && e.name.endsWith(SECTION_EXT)).map((e) => e.name).sort();
  } catch {
    return [];
  }
  const sections: LanternSection[] = [];
  for (const name of names) {
    const file = `${SECTIONS_DIR}/${name}`;
    let text: string;
    try {
      text = await fs.promises.readFile(path.join(root, file), 'utf8');
    } catch (e) {
      warnings.push(`${file}: ${(e as Error).message}`);
      continue;
    }
    const parsed = parseSection(text, file, warnings);
    if (!parsed) continue;
    const built = buildSection({ section: parsed, store, mapped, warnings }, platformIds);
    if (built) sections.push(built);
  }
  return sections.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (a.id < b.id ? -1 : 1));
}

export { SECTIONS_DIR, SCHEMA, loadSections, parseSection };

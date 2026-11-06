// @vitest-environment jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../src/main/lantern';
import { enumerateWithVerdicts } from '../src/main/lantern-enumerate';
import { parseMapFile } from '../src/main/lantern-parse';
import type { LanternMap, LanternRelation } from '../src/main/lantern';
import { enumerate } from '../skills/lantern-setup/scripts/lib.mjs';
import { BUNDLE_SKILLS, installBundle } from '../scripts/lantern-bundle.mjs';
import { mapOf, node, pr } from './helpers/lantern-map';
import { emptyFilters, layoutGraph } from '../src/renderer/lib/lanternlayout';
import { relationLayout } from '../src/renderer/lib/lanternrelview';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { fileLabel } from '../src/renderer/lib/util';

type Arrow = LanternRelation['arrow'];

const rel = (from: string, arrow: Arrow, to: string, label = ''): LanternRelation => ({ from, arrow, to, ext: null, symbol: null, label });

const SKILL = 'skills/deploy/SKILL.md';
const PROTOCOL = 'skills/deploy/protocol.md';
const CHECKLIST = 'skills/deploy/references/checklist.md';
const PREFLIGHT = 'skills/deploy/scripts/preflight.mjs';
const GENERATOR = 'skills/deploy/scripts/checklist-gen.mjs';
const COMMIT = 'skills/commit/SKILL.md';

const SKILLS_MAP: LanternMap = mapOf({
  nodes: [node(SKILL, 'skill'), node(PROTOCOL, 'skill'), node(CHECKLIST, 'skill'), node(COMMIT, 'skill'), node(PREFLIGHT, 'script'), node(GENERATOR, 'script'), node('src/app.ts', 'service')],
  relations: [
    rel(SKILL, '@', PROTOCOL, 'the delegate reads this first'),
    rel(SKILL, '@', CHECKLIST),
    rel(SKILL, '@', PREFLIGHT),
    rel(SKILL, '@', COMMIT),
    rel(PROTOCOL, '@', SKILL),
    rel(PROTOCOL, '@', PREFLIGHT),
    rel(GENERATOR, '>', CHECKLIST),
    rel('src/app.ts', '>', PREFLIGHT),
  ],
});

describe('the skills column', () => {
  const columns = (data: LanternMap, platform = '') => layoutGraph(data, { ...emptyFilters(), platform }).cols.map((c) => ({ id: c.layer.id, name: c.layer.name, files: c.items.map((i) => i.key) }));

  it('holds every skill file, left of the code columns', () => {
    const cols = columns(SKILLS_MAP);
    expect(cols[0]).toEqual({ id: 'skills', name: 'Skills', files: [COMMIT, SKILL, PROTOCOL, CHECKLIST].sort((a, b) => (path.dirname(a) === path.dirname(b) ? (a < b ? -1 : 1) : path.dirname(a) < path.dirname(b) ? -1 : 1)) });
    expect(cols.map((c) => c.id)).toEqual(['skills', 'domain', 'support']);
    expect(cols.find((c) => c.id === 'support')?.files).toEqual([GENERATOR, PREFLIGHT]);
  });

  it('keeps unknown roles in Support and shows no empty skills column', () => {
    const data = mapOf({ nodes: [node('src/a.ts', 'service'), node('src/b.ts', 'wizard')] });
    expect(columns(data).map((c) => c.id)).toEqual(['domain', 'support']);
    expect(columns(data).find((c) => c.id === 'support')?.files).toEqual(['src/b.ts']);
  });

  it('shows the column in a platform tab of any kind', () => {
    const data = mapOf({
      nodes: [node(SKILL, 'skill', { platform: 'tools' }), node(PREFLIGHT, 'script', { platform: 'tools' }), node('src/app.ts', 'service', { platform: 'web' })],
      platforms: [
        { id: 'web', kind: 'web', label: 'Web', count: 1 },
        { id: 'tools', kind: 'infra', label: 'Tools', count: 2 },
      ],
    });
    expect(columns(data, 'tools').map((c) => c.id)).toEqual(['skills', 'support']);
  });
});

describe('@ relations in the graph', () => {
  const mounted: ReturnType<typeof mountLanternView>[] = [];

  function mount(data: LanternMap = SKILLS_MAP) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, data));
    return root;
  }

  const nodeG = (root: HTMLElement, file: string) => [...root.querySelectorAll('.lt-pixi-node-access')].find((button) => button.getAttribute('aria-label') === file) as HTMLButtonElement;
  const click = (root: HTMLElement, file: string) => nodeG(root, file).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const related = (root: HTMLElement) => [...root.querySelectorAll('.lt-pixi-node-access')].filter((node) => node.getAttribute('aria-description')?.match(/selected|related/)).map((node) => node.getAttribute('aria-label')).sort();

  afterEach(() => {
    for (const view of mounted.splice(0)) view.dispose();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('labels every SKILL.md with its folder, so the skills tell apart', () => {
    const root = mount();
    const labels = [...root.querySelectorAll('.lt-pixi-node-access')].map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(['deploy/SKILL.md', 'commit/SKILL.md', 'protocol.md', 'checklist.md', 'preflight.mjs']));
    expect(labels).not.toContain('SKILL.md');
    expect(fileLabel('README.md')).toBe('README.md');
    expect(fileLabel('a/b/README.md')).toBe('b/README.md');
    expect(fileLabel('a\\b\\SKILL.md')).toBe('b/SKILL.md');
    expect(fileLabel('src/index.ts')).toBe('index.ts');
    click(root, SKILL);
    expect([...root.querySelectorAll('.lt-detail ul')[0].querySelectorAll('button[data-go]')].map((b) => b.textContent)).toContain('SKILL.md skills/commit/');
  });

  it('puts the skill files in a Skills column', () => {
    const root = mount();
    expect(nodeG(root, SKILL).getAttribute('aria-description')).toContain('skill in Skills');
    expect(nodeG(root, 'src/app.ts').getAttribute('aria-description')).toContain('service in Domain');
    expect(nodeG(root, PREFLIGHT).getAttribute('aria-description')).toContain('script in Support');
  });

  it('draws a reference from the file that names the target, head at the target, in its own colour', () => {
    const root = mount();
    click(root, SKILL);
    expect(related(root)).toEqual([CHECKLIST, COMMIT, PREFLIGHT, PROTOCOL, SKILL].sort());
    expect(root.querySelector('.lt-detail')?.textContent).toContain('the delegate reads this first');
  });

  it('keeps the colour and the head on the same end when the target is selected', () => {
    const root = mount();
    click(root, PREFLIGHT);
    expect(related(root)).toEqual([PREFLIGHT, PROTOCOL, SKILL, 'src/app.ts'].sort());
  });

  it('lifts the files a skill refers to into the related group', () => {
    const root = mount();
    click(root, SKILL);
    expect(related(root)).toEqual([CHECKLIST, COMMIT, PREFLIGHT, PROTOCOL, SKILL].sort());
    expect(Number(nodeG(root, PREFLIGHT).dataset.graphY)).toBeLessThan(Number(nodeG(root, GENERATOR).dataset.graphY));
  });

  it('lists references in the detail panel, and the files that refer to the selected one apart from imports', () => {
    const root = mount();
    click(root, SKILL);
    const headings = [...root.querySelectorAll('.lt-detail h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Refers to', 'Referred to by']);
    const [refersTo, referredBy] = [...root.querySelectorAll('.lt-detail ul')];
    expect([...refersTo.querySelectorAll('button[data-go]')].map((b) => b.getAttribute('data-go')).sort()).toEqual([COMMIT, CHECKLIST, PREFLIGHT, PROTOCOL].sort());
    expect(refersTo.querySelector('.g.k-ref')?.textContent).toBe('⇢');
    expect(refersTo.querySelector('.lab')?.textContent).toBe('the delegate reads this first');
    expect([...referredBy.querySelectorAll('button[data-go]')].map((b) => b.getAttribute('data-go'))).toEqual([PROTOCOL]);
    click(root, SKILL);
    click(root, PREFLIGHT);
    expect([...root.querySelectorAll('.lt-detail h3')].map((h) => h.textContent)).toEqual(['Used by', 'Referred to by']);
  });

  it('offers a reference chip that filters the graph to references', () => {
    const root = mount();
    const chip = root.querySelector('.chip[data-kind="@"]') as HTMLButtonElement;
    expect(chip.textContent).toContain('refers to');
    expect(chip.textContent).toContain('6');
    expect(chip.classList.contains('k-ref')).toBe(true);
    chip.click();
    const after = root.querySelector('.chip[data-kind="@"]') as HTMLButtonElement;
    expect(after.getAttribute('aria-pressed')).toBe('true');
    click(root, PREFLIGHT);
    expect(related(root)).toEqual([PREFLIGHT, PROTOCOL, SKILL].sort());
  });

  it('explains the line in the legend', () => {
    const root = mount();
    expect(root.querySelector('.legend .kswatch path.k-ref')?.getAttribute('marker-end')).toBe(`url(#${root.querySelector('.kswatch marker.k-ref')?.getAttribute('id')})`);
    expect(root.querySelector('.legend')?.textContent).toContain('refers to (@)');
  });

  it('lists the files that refer to the selected one on the left of the relation view, the ones it refers to on the right', () => {
    const root = mount();
    click(root, SKILL);
    (root.querySelector('.lt-rvtoggle') as HTMLButtonElement).click();
    expect(nodeG(root, SKILL).tabIndex).toBe(-1);
    expect(related(root)).toEqual([CHECKLIST, COMMIT, PREFLIGHT, PROTOCOL, SKILL].sort());
  });
});

describe('pull request overlay', () => {
  it('marks a changed SKILL.md like any changed file and dims the rest', () => {
    const data = { ...SKILLS_MAP, prs: [pr('5', { files: [{ path: SKILL, kind: 'modified' as const, mapped: true, reason: 'Tells the delegate to read the protocol first.' }] })] };
    const root = document.createElement('div');
    document.body.appendChild(root);
    const view = mountLanternView(root, data, { pr: '5' });
    const g = (file: string) => root.querySelector(`.lt-pixi-node-access[aria-label="${file}"]`);
    expect(g(SKILL)?.getAttribute('class')).toContain('pr-hit');
    expect(g(PROTOCOL)?.getAttribute('class')).toContain('pr-off');
    expect(root.textContent).toContain('Tells the delegate to read the protocol first.');
    view.dispose();
    root.remove();
  });
});

describe('relation layout of references', () => {
  const layout = (centre: string) => relationLayout(layoutGraph(SKILLS_MAP, emptyFilters()), centre);
  const zone = (R: ReturnType<typeof layout>, side: string) => R.zones.find((z) => z.side === side);

  it('puts what the file refers to on the right and what refers to it on the left', () => {
    const R = layout(CHECKLIST);
    expect(zone(R, 'in')?.refs).toBe('mixed');
    expect(zone(R, 'out')).toBeUndefined();
    const SK = layout(COMMIT);
    expect(zone(SK, 'in')?.refs).toBe('all');
    expect(SK.edges.map((e) => [e.side, e.ref])).toEqual([['in', true]]);
    const FROM = layout(SKILL);
    expect(zone(FROM, 'out')?.refs).toBe('all');
    expect(FROM.edges.filter((e) => e.side === 'out' && e.ref)).toHaveLength(3);
  });

  it('puts two files that point at each other in the both-ways zone', () => {
    const R = layout(PROTOCOL);
    expect(zone(R, 'both')?.refs).toBe('all');
    const mutual = R.edges.find((e) => e.side === 'both');
    expect(mutual?.ref).toBe(true);
    expect(mutual?.relations.map((r) => r.arrow).sort()).toEqual(['@', '@']);
  });

  it('keeps a reference and a data flow apart on the same zone', () => {
    const R = layout(CHECKLIST);
    expect(R.edges.map((e) => [e.key, e.ref]).sort()).toEqual([[GENERATOR, false], [SKILL, true]].sort());
  });

  it('treats a reference like any other relation for a file with only references', () => {
    const lonely = mapOf({ nodes: [node(SKILL, 'skill'), node(PROTOCOL, 'skill')], relations: [rel(SKILL, '@', PROTOCOL)] });
    const R = relationLayout(layoutGraph(lonely, emptyFilters()), PROTOCOL);
    const pos = (k: string) => R.pos.get(k) as { x: number; w: number };
    expect(pos(SKILL).x + pos(SKILL).w).toBeLessThan(pos(PROTOCOL).x);
  });
});

describe('the main process reads skill maps', () => {
  let project: string;

  const write = (rel: string, text: string) => {
    const file = path.join(project, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skillgraph-'));
  });

  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  it('parses an @ relation with its target, symbol and label', () => {
    const text = ['lantern 1', '# skills/deploy', '', 'skills/deploy/SKILL.md . skill 3f9a1c2b4d5e | planner entry', '  @ skills/deploy/protocol.md | read first', '  @ skills/deploy/scripts/preflight.mjs#preflight', '  > ext:x'].join('\n');
    const parsed = parseMapFile(text, '.lantern/map/skills/deploy.lantern');
    expect(parsed.errors).toEqual([]);
    expect(parsed.records[0].relations.map((r) => [r.arrow, r.to, r.symbol, r.label])).toEqual([
      ['@', 'skills/deploy/protocol.md', null, 'read first'],
      ['@', 'skills/deploy/scripts/preflight.mjs', 'preflight', ''],
      ['>', null, null, ''],
    ]);
    expect(parseMapFile('lantern 1\n# a\nx.md . skill 3f9a1c2b4d5e\n  ! y.md', '.lantern/map/a.lantern').errors[0]).toMatch(/arrow one of > < = @/);
  });

  it('loads skill nodes and their references, and counts unmapped markdown', async () => {
    write('skills/deploy/SKILL.md', '# deploy\nRead protocol.md\n');
    write('skills/deploy/protocol.md', '# protocol\n');
    write('skills/deploy/notes.md', '# notes\n');
    write('README.md', '# readme\n');
    write('.lantern/map/skills/deploy.lantern', ['lantern 1', '# skills/deploy', 'skills/deploy/SKILL.md . skill 000000000000 | planner', '  @ skills/deploy/protocol.md | read first', 'skills/deploy/protocol.md . skill 000000000000 | delegate steps'].join('\n'));
    const map = await load(project);
    expect(map.nodes.map((n) => [n.path, n.role])).toEqual([
      ['skills/deploy/SKILL.md', 'skill'],
      ['skills/deploy/protocol.md', 'skill'],
    ]);
    expect(map.relations).toEqual([{ from: 'skills/deploy/SKILL.md', arrow: '@', to: 'skills/deploy/protocol.md', ext: null, symbol: null, label: 'read first' }]);
    expect(map.unmapped).toEqual(['skills/deploy/notes.md']);
    expect(map.total).toBe(3);
  });

  it('never maps what the real installer and the mapper agent put into .claude', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skillgraph-home-'));
    try {
      const skills = path.join(__dirname, '..', 'skills');
      const result = installBundle({ project, root: skills, home });
      expect(Object.values(result.skills)).toEqual(BUNDLE_SKILLS.map(() => 'installed'));
      expect(result.agents?.status).toBe('installed');
      write('.claude/agents/lantern-mapper.md', fs.readFileSync(path.join(skills, 'lantern-setup', 'agents', 'lantern-mapper.md'), 'utf8'));
      write('.claude/agents/triage.md', '# triage\n');
      write('core/x/SKILL.md', '# x\n');
      expect(fs.existsSync(path.join(project, '.claude/skills/lantern-setup/SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(project, '.claude/agents/lantern-delegate-low.md'))).toBe(true);
      const reference = enumerate(project).map((f: { path: string }) => f.path);
      const app = (await enumerateWithVerdicts(project)).files.map((f) => f.path);
      expect(reference).toEqual(['.claude/agents/triage.md', 'core/x/SKILL.md']);
      expect(app).toEqual(reference);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('enumerates exactly what the reference script does, markdown rules and .lantern/include included', async () => {
    const files: Record<string, string> = {
      'skills/commit/SKILL.md': '# s\n',
      'skills/commit/protocol.md': '# p\n',
      'skills/commit/references/r.md': '# r\n',
      'skills/commit/scripts/run.mjs': 'export const run = 1;\n',
      'skills/commit/draft.md': '# d\n',
      'skills/commit/.gitignore': 'draft.md\n',
      'CLAUDE.md': '# c\n',
      'packages/api/AGENTS.md': '# a\n',
      '.github/copilot-instructions.md': '# i\n',
      '.github/PULL_REQUEST_TEMPLATE.md': '# t\n',
      '.claude/commands/ship.md': '# ship\n',
      '.claude/agents/reviewer.md': '# rev\n',
      '.claude/rules/style.md': '# style\n',
      '.claude/skills/local/SKILL.md': '# local\n',
      '.claude/skills/local/scripts/x.mjs': 'export const x = 1;\n',
      '.claude/skills/lantern-setup/SKILL.md': '# installed copy\n',
      '.claude/skills/lantern-setup/.lantern-bundle': 'abc\n',
      '.claude/agents/lantern-mapper.md': '# mapper\n',
      '.claude/agents/lantern-delegate-low.md': '# delegate\n',
      '.claude/agents/.lantern-bundle-agents': 'abc\nlantern-delegate-low.md\n',
      '.claude/settings.json': '{}\n',
      '.claude/notes.md': '# n\n',
      'packages/web/.claude/commands/ship.md': '# ship\n',
      'README.md': '# r\n',
      'docs/guide.md': '# g\n',
      'docs/architecture/overview.md': '# o\n',
      'docs/private/secret.md': '# s\n',
      'notes/gone.md': '# gone\n',
      'src/index.ts': 'export const i = 1;\n',
      'node_modules/pkg/SKILL.md': '# vendored\n',
      '.lantern/include': 'docs/architecture/\ndocs/private/\n',
      '.lantern/ignore': 'docs/private/\nnotes/\n',
    };
    for (const [rel, text] of Object.entries(files)) write(rel, text);
    const reference = enumerate(project).map((f: { path: string }) => f.path);
    const app = (await enumerateWithVerdicts(project)).files.map((f) => f.path);
    expect(app).toEqual(reference);
    expect(app).toEqual([
      '.claude/agents/reviewer.md',
      '.claude/commands/ship.md',
      '.claude/rules/style.md',
      '.claude/skills/local/SKILL.md',
      '.github/copilot-instructions.md',
      'CLAUDE.md',
      'docs/architecture/overview.md',
      'packages/api/AGENTS.md',
      'skills/commit/SKILL.md',
      'skills/commit/protocol.md',
      'skills/commit/references/r.md',
      'skills/commit/scripts/run.mjs',
      'src/index.ts',
    ]);
  });
});

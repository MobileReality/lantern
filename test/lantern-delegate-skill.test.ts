import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILL = path.join(__dirname, '..', 'skills', 'lantern-delegate');
const read = (rel: string) => fs.readFileSync(path.join(SKILL, rel), 'utf8');

function frontmatter(text: string) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  return Object.fromEntries(
    block
      .split('\n')
      .map((line) => /^([a-zA-Z-]+):\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
}

describe('lantern-delegate skill folder', () => {
  it('has a named, user-invocable SKILL.md', () => {
    const text = read('SKILL.md');
    const meta = frontmatter(text);
    expect(meta.name).toBe('lantern-delegate');
    expect(meta['user-invocable']).toBe('true');
    expect(meta.description.length).toBeGreaterThan(100);
  });

  it('ships one Sonnet agent type per effort level, worktree-isolated, pointing at protocol.md', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh']) {
      const text = read(`agents/lantern-delegate-${effort}.md`);
      expect(frontmatter(text)).toMatchObject({
        name: `lantern-delegate-${effort}`,
        model: 'sonnet',
        effort,
        isolation: 'worktree',
      });
      expect(text).toContain("the `lantern-delegate` skill's `protocol.md`");
    }
  });

  it('ships a reviewer that cannot edit', () => {
    const meta = frontmatter(read('agents/reviewer.md'));
    expect(meta.name).toBe('reviewer');
    expect(meta.disallowedTools).toBe('Edit, Write, NotebookEdit');
  });

  it('says the app or install-skills installs the agents, and lists no Opus or Haiku type', () => {
    const skill = read('SKILL.md');
    expect(skill).toContain('when the project is opened in it');
    expect(skill).toContain('pnpm run install-skills -- <project>');
    expect(skill).not.toContain('Not fixable in-flight');
    expect(skill).toContain('Retry the `Agent` dispatch once');
    expect(skill).not.toContain('cp .claude/skills/lantern-delegate/agents');
    const agents = fs.readdirSync(path.join(SKILL, 'agents')).sort();
    expect(agents).toEqual(['lantern-delegate-high.md', 'lantern-delegate-low.md', 'lantern-delegate-medium.md', 'lantern-delegate-xhigh.md', 'reviewer.md']);
    expect(skill).not.toMatch(/delegate-haiku|opus-(medium|high)/);
    expect(skill.match(/delegate-sonnet-/g)).toHaveLength(1);
  });

  it('does not load the skills-repo delegate skills by name', () => {
    for (const file of ['protocol.md', 'agents/lantern-delegate-low.md']) {
      expect(read(file)).not.toMatch(/delegate-sonnet/);
    }
  });

  it('cites only scripts that exist', () => {
    const cited = new Set<string>();
    for (const file of ['SKILL.md', 'protocol.md', 'README.md']) {
      for (const m of read(file).matchAll(/\$D\/(scripts\/[\w/.-]+\.mjs)|skills\/lantern-delegate\/(scripts\/[\w/.-]+\.mjs)|`(scripts\/[\w/.-]+\.mjs)`/g)) {
        cited.add(m[1] ?? m[2] ?? m[3]);
      }
    }
    expect(cited.size).toBeGreaterThanOrEqual(4);
    for (const rel of cited) expect(fs.existsSync(path.join(SKILL, rel)), rel).toBe(true);
  });

  it('keeps the cost-block markers the append script replaces', () => {
    const protocol = read('protocol.md');
    expect(protocol).toContain('<!-- delegate:cost -->');
    expect(protocol).toContain('<!-- /delegate:cost -->');
    expect(protocol).toContain('## Run cost');
  });

  it('carries the stacked-base rule in the brief template and in the protocol', () => {
    expect(read('SKILL.md')).toContain('`git fetch origin`, then `git reset --hard origin/<base>`');
    expect(read('protocol.md')).toContain('git fetch origin\ngit reset --hard origin/<base>');
  });

  it('gates the handover on verify with --require-pr, --branch and --root', () => {
    expect(read('SKILL.md')).toMatch(/sync\.mjs verify --base <target> --require-pr --require-reason --require-order --require-flow \\\n\s+--branch <type>\/<slug> --root \.claude\/worktrees\/agent-<id>/);
    expect(read('protocol.md')).toContain('sync.mjs verify --base <target> --require-pr --require-reason --require-order --require-flow --branch <type>/<slug>');
  });

  it('has the delegate write the PR flow at the PR record step, and the map gate require it', () => {
    const protocol = read('protocol.md');
    expect(protocol).toMatch(/sync\.mjs pr <id> .*--flow-file \.ai\/tmp\/flow\.json/);
    expect(protocol).toMatch(/\*\*Write the PR's flow too\*\*, in plain words from the user's point of view, never naming a file or a\s+function/);
    expect(protocol).toMatch(/who triggers the change[\s\S]*what they do[\s\S]*who or what it is done to[\s\S]*what that party can now do in the app[\s\S]*what changes/);
    expect(read('SKILL.md')).toMatch(/--require-flow. does the same for the flow/);
  });

  it('has the delegate point each flow step at the changed files behind it, inventing none, and documents the #file line', () => {
    const protocol = read('protocol.md');
    expect(protocol).toMatch(/\*\*Point each step at its files\*\*: give a step `"files": \["src\/a\.ts"\]` \(up to 6 paths/);
    expect(protocol).toMatch(/invent no\s+link: a step no changed file stands behind gets none/);
    expect(protocol).toMatch(/`verify` warns when no step has any/);
    expect(fs.readFileSync(path.join(__dirname, '..', 'skills', 'lantern-setup', 'references', 'format.md'), 'utf8')).toMatch(/`#file <path>` lines directly under its `#step` or `#below` line/);
  });

  it('has the delegate write one reason per changed file where it writes the PR record, and the orchestrator read them', () => {
    const protocol = read('protocol.md');
    expect(protocol).toMatch(/sync\.mjs pr <id> .*--reason-file \.ai\/tmp\/reason\.json/);
    expect(protocol).toMatch(/one sentence, the \*why\*/);
    expect(read('SKILL.md')).toMatch(/--require-reason. makes a changed file without a reason a red result/);
  });

  it('seeds an untracked map instead of dropping the Lantern block, and never skips silently', () => {
    const skill = read('SKILL.md');
    const protocol = read('protocol.md');
    expect(skill).toContain('sync.mjs status --base <target>');
    expect(skill).toContain('map: untracked on <base>');
    expect(skill).toContain('chore: add the Lantern map');
    expect(skill).toMatch(/Seed: `\.lantern\/` is untracked on `<base>`/);
    expect(protocol).toMatch(/Seed the map, only when the brief's `Lantern` block has a `Seed` line/);
    expect(protocol).toContain('chore: add the Lantern map');
    expect(protocol).toMatch(/no `\.lantern\/map` after this[\s\S]*Never skip the\s+Lantern steps silently/);
  });

  it('runs a fresh folder with no remote as local mode, in the skill and the protocol', () => {
    const skill = read('SKILL.md');
    const protocol = read('protocol.md');
    expect(skill).toContain('chore: initial commit');
    expect(skill).toContain('node $D/scripts/init-local.mjs');
    expect(skill).toContain('more than 5000 files after ignoring');
    expect(skill).toMatch(/\*\*No remote at all = local mode\*\*/);
    expect(skill).toContain('git merge --no-ff <type>/<slug>');
    expect(skill).toContain('map: <N> files re-mapped, branch record written for <branch>');
    expect(skill).toMatch(/Status\*\* is exactly one of[\s\S]*`branch ready`/);
    expect(skill).toMatch(/`git init` runs only in the preflight step/);
    expect(protocol).toContain('## Local mode');
    expect(protocol).toMatch(/Never run\*\* `git push` or `pr-create\.mjs`/);
    expect(protocol).toContain('git reset --hard <base>');
    expect(protocol).toContain('then step 10 (the record with no host PR) and\n  step 13');
    expect(protocol).not.toContain('no PR record (local mode)');
    expect(protocol).toContain('local\n  record path in place of the PR record path');
  });

  it('lets a follow-up stack on an unmerged branch instead of waiting for a human merge', () => {
    const skill = read('SKILL.md');
    expect(skill).toMatch(/A follow-up never waits for a human merge/);
    expect(skill).toMatch(/map-only PR/);
    expect(skill).toMatch(/stacked\*\* on that\s+pushed branch[\s\S]*PR target are that branch/);
    expect(skill).toMatch(/merge\s+bottom-up/);
  });

  it('offers a settings.json snippet and states what a delegate cannot do, before dispatch', () => {
    const skill = read('SKILL.md');
    expect(skill).toContain('fails\n`permissions`');
    expect(skill).toContain('scripts/permissions.mjs');
    expect(skill).toMatch(/note limits.*cannot answer a prompt[\s\S]*npx convex dev/);
    expect(read('protocol.md')).toMatch(/rejects `git -C <other dir>` and\s+`cd <other dir> && git/);
    expect(read('protocol.md')).toMatch(/never `git checkout` or `git merge` to look at one/);
  });

  it('clears the seeded copy after the seed PR merges, and does not ask whether to open a PR', () => {
    const skill = read('SKILL.md');
    expect(skill).toMatch(/After a seed PR\s+merges[\s\S]*sync\.mjs tidy --base <target>/);
    expect(skill).toContain('a task to open a PR is not a question');
    expect(read('protocol.md')).toContain('Opening the PR is the task, not a question');
    const sync = fs.readFileSync(path.join(__dirname, '..', 'skills', 'lantern-sync', 'SKILL.md'), 'utf8');
    expect(sync).toMatch(/do not ask\s+first whether to commit or push/);
    expect(sync).toMatch(/git worktree add --detach \.ai\/tmp\/pr-<id> origin\//);
    expect(sync).toMatch(/A map-only PR is recorded like any other/);
  });

  it('tells the delegate to edit .lantern/ with the Edit tool, never sed -i', () => {
    const protocol = read('protocol.md');
    expect(protocol).toMatch(/Edit `\.lantern\/` files only with the Edit tool/);
    expect(protocol).toMatch(/never `sed -i`/);
    expect(protocol).not.toMatch(/(?<!never\s+)`sed -i/);
  });

  it('has the delegate order the files for review at the PR record step, and the orchestrator check it', () => {
    const protocol = read('protocol.md');
    expect(protocol).toMatch(/sync\.mjs pr <id> .*--order-file \.ai\/tmp\/order\.json/);
    expect(protocol).toMatch(/core idea or contract[\s\S]*then the logic that uses it[\s\S]*then wiring\/IPC\/UI, then\s+tests, then map\/docs\/generated files last/);
    expect(read('SKILL.md')).toMatch(/--require-order. does the same for the review order/);
  });
});

describe('skills link step', () => {
  it('has the delegate symlink the main checkout skills in right after the base reset', () => {
    const protocol = read('protocol.md');
    const reset = protocol.indexOf('git reset --hard origin/<base>');
    const link = protocol.indexOf('**Link the skills next.**');
    expect(reset).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(reset);
    expect(protocol).toMatch(/^mkdir -p \.claude\nln -s <skills path from the brief> \.claude\/skills$/m);
    expect(protocol).toContain('.claude/skills/lantern-sync/scripts/sync.mjs');
    expect(protocol).toMatch(/Nothing in\s+`\.claude\/` is ever committed or `git add`ed/);
  });

  it('puts the Skills line in both brief templates and says reason', () => {
    const skill = read('SKILL.md');
    expect(skill.match(/^Skills: <main checkout path>\/\.claude\/skills$/gm)).toHaveLength(1);
    expect(skill).toMatch(/plus the same\s+`Skills: <main checkout path>\/\.claude\/skills` line/);
    expect(skill).toMatch(/only\s+you know the main checkout's real path, the delegate does not/);
    expect(skill).toMatch(/Write that path out literally \(absolute, no `~`, no variable\)/);
  });

  it('carries the skill linker conventions in a Conventions block of the brief, not in protocol.md', () => {
    const protocol = read('protocol.md');
    const skill = read('SKILL.md');
    expect(protocol).not.toMatch(/Skill linker/);
    expect(skill.match(/^## Conventions\nSkill linker: <literal absolute path the gate printed>$/gm)).toHaveLength(1);
    expect(skill).toMatch(/<Skill linker> \. --skill typescript/);
    expect(skill).toMatch(/never its bare name as a command[\s\S]*never through `sh -c`/);
    expect(skill).toMatch(/Skip any name already in `\.claude\/skills`/);
    expect(skill).toMatch(/record the command and\s+its output in the Report/);
    expect(skill).toMatch(/Tell your reviewer to name the language and stack[\s\S]*name\s+in its verdict the conventions it used and any it could not use/);
    expect(skill).not.toMatch(/Give your reviewer the same `Skill linker:` path/);
    expect(skill).toMatch(/Append the `## Conventions` block when, and only when, the gate prints a skill linker path/);
  });

  it('states link, then read SKILL.md from disk, then follow it, in the Conventions block', () => {
    const skill = read('SKILL.md');
    expect(skill).toMatch(/^Linking a skill means reading it: after each `--skill <name>` read `\.claude\/skills\/<name>\/SKILL\.md` from disk/m);
    expect(skill).toMatch(/also read its `\.claude\/skills\/<name>\/SKILL\.md` from disk/);
    expect(skill).toContain('lint-skill-reads.mjs --agent-id');
  });

  it('wires lint-reviewer into the handover and dispatches only the reviewer agent', () => {
    expect(read('SKILL.md')).toContain('lint-reviewer.mjs --agent-id');
    const protocol = read('protocol.md');
    expect(protocol).toContain('`subagent_type: "reviewer"` and nothing else');
    expect(protocol).toContain('reviewer agent missing');
    expect(read('SKILL.md')).toContain('`reviewer` has no fallback');
  });

  it('has a protocol the worktree guard accepts: literal skill paths, no heredoc, no chained commands', () => {
    const protocol = read('protocol.md');
    const commandLines = [...protocol.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n')).concat(
      protocol.split('\n').filter((l) => /`(node|git) /.test(l)),
    );
    expect(protocol).not.toMatch(/\$[SDL]\//);
    expect(protocol).not.toMatch(/<<-?\s*'?\w+/);
    expect(protocol).toContain('**Commands the guard accepts.**');
    expect(protocol).toContain('node <Skills>/lantern-sync/scripts/sync.mjs finish');
    for (const line of commandLines) {
      const code = line.replace(/\\$/, '');
      const cmds = [...code.matchAll(/`((?:node|git) [^`]*)`/g)].map((m) => m[1]);
      for (const cmd of /^\s*(node|git) /.test(code) ? [code, ...cmds] : cmds) {
        expect(cmd, cmd).not.toMatch(/&&|\|\||;|\| |\$\(|`/);
      }
    }
  });
});

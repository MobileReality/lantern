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

  it('lists no Opus or Haiku agent type', () => {
    const agents = fs.readdirSync(path.join(SKILL, 'agents')).sort();
    expect(agents).toEqual(['lantern-delegate-high.md', 'lantern-delegate-low.md', 'lantern-delegate-medium.md', 'lantern-delegate-xhigh.md', 'reviewer.md']);
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
});

describe('skills link step', () => {
  it('has a protocol the worktree guard accepts: literal skill paths, no heredoc, no chained commands', () => {
    const protocol = read('protocol.md');
    const commandLines = [...protocol.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n')).concat(
      protocol.split('\n').filter((l) => /`(node|git) /.test(l)),
    );
    expect(protocol).not.toMatch(/\$[SDL]\//);
    expect(protocol).not.toMatch(/<<-?\s*'?\w+/);
    for (const line of commandLines) {
      const code = line.replace(/\\$/, '');
      const cmds = [...code.matchAll(/`((?:node|git) [^`]*)`/g)].map((m) => m[1]);
      for (const cmd of /^\s*(node|git) /.test(code) ? [code, ...cmds] : cmds) {
        expect(cmd, cmd).not.toMatch(/&&|\|\||;|\| |\$\(|`/);
      }
    }
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeBase, normalizeSiteUrl } from '../website/plugins/site';
import { collectLinkTargets, hashFor, parseHash, resolveLink } from '../website/src/lib/links';
import { findPageByRoute, PAGES } from '../website/src/lib/pages';

const ROOT = path.resolve(__dirname, '..');

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('docs site pages', () => {
  it('has a Markdown source for every page, with a distinct route', () => {
    for (const page of PAGES) expect(fs.existsSync(path.join(ROOT, page.file)), page.file).toBe(true);
    expect(new Set(PAGES.map((page) => page.route)).size).toBe(PAGES.length);
  });

  it('opens on the docs home written in docs/index.md, not on the README', () => {
    expect(findPageByRoute('/')?.file).toBe('docs/index.md');
    expect(PAGES.map((page) => page.file)).not.toContain('README.md');
    const index = read('docs/index.md');
    expect(index).toMatch(/^# Lantern documentation$/m);
    expect(index).toMatch(/^## Where to start$/m);
    for (const target of ['installation.md', 'getting-started.md', 'architecture.md', '../TROUBLESHOOTING.md', '../CONTRIBUTING.md']) {
      expect(index, target).toContain(`](${target})`);
    }
    expect(index).toContain('https://thelantern.dev');
  });

  it('lists the pages in reading order', () => {
    expect(PAGES.map((page) => page.route)).toEqual([
      '/',
      '/installation',
      '/getting-started',
      '/architecture',
      '/troubleshooting',
      '/contributing',
    ]);
  });

  it('resolves every relative link in the sources to a page, an image or an existing repository path', () => {
    const broken: string[] = [];
    for (const page of PAGES) {
      for (const target of collectLinkTargets(read(page.file))) {
        const link = resolveLink(page.file, target);
        if (link.kind === 'page' && !findPageByRoute(link.route)) broken.push(`${page.file}: ${target}`);
        if ((link.kind === 'repo' || link.kind === 'asset') && !fs.existsSync(path.join(ROOT, link.path))) {
          broken.push(`${page.file}: ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('rewrites links between the Markdown files to routes', () => {
    expect(resolveLink('docs/installation.md', 'architecture.md#the-dev-profile')).toEqual({
      kind: 'page',
      route: '/architecture',
      anchor: 'the-dev-profile',
    });
    expect(resolveLink('docs/getting-started.md', 'index.md')).toEqual({ kind: 'page', route: '/', anchor: '' });
    expect(resolveLink('docs/getting-started.md', '../README.md')).toEqual({ kind: 'repo', path: 'README.md' });
    expect(resolveLink('docs/getting-started.md', 'architecture.md')).toMatchObject({ kind: 'page', route: '/architecture' });
    expect(resolveLink('docs/architecture.md', '../CONTRIBUTING.md#skills')).toEqual({
      kind: 'page',
      route: '/contributing',
      anchor: 'skills',
    });
  });

  it('resolves relative images, same-page anchors, external links and repository-only files', () => {
    expect(resolveLink('docs/index.md', 'assets/logo.png')).toEqual({ kind: 'asset', path: 'docs/assets/logo.png' });
    expect(resolveLink('docs/architecture.md', '#routing')).toEqual({ kind: 'anchor', anchor: 'routing' });
    expect(resolveLink('docs/index.md', 'https://example.com/x')).toEqual({ kind: 'external', href: 'https://example.com/x' });
    expect(resolveLink('docs/index.md', 'mailto:a@b.c')).toEqual({ kind: 'external', href: 'mailto:a@b.c' });
    expect(resolveLink('docs/architecture.md', '../skills')).toEqual({ kind: 'repo', path: 'skills' });
    expect(resolveLink('docs/index.md', '../LICENSE')).toEqual({ kind: 'repo', path: 'LICENSE' });
  });

  it('ignores links inside code', () => {
    const markdown = ['`[x](gone.md)`', '```', '[y](gone.md)', '```', '[z](docs/architecture.md)'].join('\n');
    expect(collectLinkTargets(markdown)).toEqual(['docs/architecture.md']);
  });

  it('round-trips hash routes with an anchor', () => {
    expect(parseHash('')).toEqual({ route: '/', anchor: '' });
    expect(parseHash('#/')).toEqual({ route: '/', anchor: '' });
    expect(parseHash('#/architecture')).toEqual({ route: '/architecture', anchor: '' });
    expect(parseHash(hashFor('/architecture', 'the-dev-profile'))).toEqual({ route: '/architecture', anchor: 'the-dev-profile' });
  });
});

describe('docs site identity', () => {
  const html = read('website/index.html');

  it('is served at docs.thelantern.dev, with a CNAME holding only that host', () => {
    expect(read('website/public/CNAME')).toBe('docs.thelantern.dev\n');
  });

  it('is titled Lantern documentation with a description that is not the motto', () => {
    expect(html).toMatch(/<title>Lantern documentation<\/title>/);
    expect(html).toMatch(/<meta name="description" content="Documentation for Lantern/);
    expect(html).toMatch(/<meta property="og:title" content="Lantern documentation"/);
    expect(html).not.toMatch(/whole context for your AI/);
  });

  it('keeps no marketing hero or figure showcase', () => {
    const components = fs.readdirSync(path.join(ROOT, 'website/src/components'), { recursive: true }).map(String);
    expect(components.filter((file) => /hero|showcase|home/i.test(file))).toEqual([]);
    for (const gone of ['website/public/figures', 'website/src/styles/showcase.css', 'website/src/styles/home.css']) {
      expect(fs.existsSync(path.join(ROOT, gone)), gone).toBe(false);
    }
  });
});

describe('docs site legal lines', () => {
  const NOT_AFFILIATED =
    'Lantern is not affiliated with or endorsed by Anthropic, OpenAI, Microsoft, Atlassian or GitHub; their names and marks are trademarks of their owners.';

  it('says the same not-affiliated sentence in the README, the docs home and the site footer', () => {
    for (const file of ['README.md', 'docs/index.md', 'website/src/App.tsx']) expect(read(file), file).toContain(NOT_AFFILIATED);
  });

  it('shows the licence and the copyright holder of LICENSE in the site footer', () => {
    expect(read('LICENSE')).toContain('Copyright (c) 2026 Mobile Reality');
    expect(read('website/src/App.tsx')).toContain('Lantern is released under the MIT License. Copyright (c) 2026 Mobile Reality.');
  });
});

describe('docs site build settings', () => {
  it('serves at the root by default and at any path on request', () => {
    expect(normalizeBase(undefined)).toBe('/');
    expect(normalizeBase('')).toBe('/');
    expect(normalizeBase('/')).toBe('/');
    expect(normalizeBase('lantern')).toBe('/lantern/');
    expect(normalizeBase('/lantern/')).toBe('/lantern/');
  });

  it('leaves the site URL out unless it is given, and demands a scheme', () => {
    expect(normalizeSiteUrl(undefined)).toBeNull();
    expect(normalizeSiteUrl('  ')).toBeNull();
    expect(normalizeSiteUrl('https://example.com/lantern')).toBe('https://example.com/lantern/');
    expect(() => normalizeSiteUrl('example.com')).toThrow(/http/);
  });
});

describe('docs site isolation', () => {
  const rootPackage = JSON.parse(read('package.json')) as Record<string, unknown>;

  it('has its own manifest and lockfile', () => {
    expect(fs.existsSync(path.join(ROOT, 'website/package.json'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'website/pnpm-lock.yaml'))).toBe(true);
  });

  it('stays out of the root workspace, lockfile, dependencies and TypeScript project', () => {
    expect(read('pnpm-workspace.yaml')).not.toMatch(/website/);
    expect(read('pnpm-lock.yaml')).not.toMatch(/website|lantern-docs-site/);
    expect(JSON.stringify(rootPackage)).not.toMatch(/website|lantern-docs-site/);
    expect(read('tsconfig.json')).not.toMatch(/website/);
  });

  it('is its own pnpm workspace root, so pnpm never installs it into the root lockfile', () => {
    expect(read('website/pnpm-workspace.yaml')).toMatch(/packages:\s*\n\s*-\s*'\.'/);
  });
});

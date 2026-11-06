import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { extractHeadings } from '../src/lib/headings';
import { collectLinkTargets, resolveLink } from '../src/lib/links';
import { findPageByRoute, PAGES } from '../src/lib/pages';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function readPage(file: string): string {
  return readFileSync(`${REPO_ROOT}${file}`, 'utf8');
}

function headingIds(file: string): Set<string> {
  return new Set(extractHeadings(readPage(file)).map((heading) => heading.id));
}

export function findBrokenLinks(): string[] {
  const problems: string[] = [];
  for (const page of PAGES) {
    for (const target of collectLinkTargets(readPage(page.file))) {
      const link = resolveLink(page.file, target);
      const where = `${page.file}: ${target}`;
      if (link.kind === 'anchor' && !headingIds(page.file).has(link.anchor)) problems.push(`${where} (no such heading)`);
      if (link.kind === 'page') {
        const destination = findPageByRoute(link.route);
        if (destination && link.anchor && !headingIds(destination.file).has(link.anchor)) problems.push(`${where} (no such heading in ${destination.file})`);
      }
      if ((link.kind === 'repo' || link.kind === 'asset') && !existsSync(`${REPO_ROOT}${link.path}`)) problems.push(`${where} (no such file)`);
    }
  }
  return problems;
}

export function checkLinksPlugin(): Plugin {
  return {
    name: 'lantern-docs-check-links',
    buildStart() {
      const problems = findBrokenLinks();
      if (problems.length > 0) this.error(`Broken links in the documentation sources:\n${problems.join('\n')}`);
    },
  };
}

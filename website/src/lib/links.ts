import { findPageByFile, HOME_ROUTE } from './pages';

export type ResolvedLink =
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'page'; route: string; anchor: string }
  | { kind: 'asset'; path: string }
  | { kind: 'repo'; path: string };

export type HashLocation = { route: string; anchor: string };

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const IMAGE = /\.(?:png|jpe?g|gif|svg|webp)$/i;
const FENCE = /^\s*(```|~~~)/;
const MARKDOWN_LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_REFERENCE = /\b(?:src|href)="([^"]+)"/g;

function repoPath(directory: string, relative: string): string | null {
  const parts = directory ? directory.split('/') : [];
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') {
      parts.push(segment);
      continue;
    }
    if (parts.length === 0) return null;
    parts.pop();
  }
  return parts.join('/');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveLink(fromFile: string, href: string): ResolvedLink {
  if (EXTERNAL.test(href)) return { kind: 'external', href };
  if (href.startsWith('#')) return { kind: 'anchor', anchor: safeDecode(href.slice(1)) };
  const [pathPart, ...anchorParts] = href.split('#');
  const anchor = safeDecode(anchorParts.join('#'));
  const directory = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const target = repoPath(directory, safeDecode(pathPart.split('?')[0]));
  if (target === null) return { kind: 'repo', path: pathPart };
  const page = findPageByFile(target);
  if (page) return { kind: 'page', route: page.route, anchor };
  if (IMAGE.test(target)) return { kind: 'asset', path: target };
  return { kind: 'repo', path: target };
}

export function hashFor(route: string, anchor = ''): string {
  return `#${route}${anchor ? `#${anchor}` : ''}`;
}

export function parseHash(hash: string): HashLocation {
  const body = hash.replace(/^#/, '');
  const split = body.indexOf('#');
  const rawRoute = split === -1 ? body : body.slice(0, split);
  const anchor = split === -1 ? '' : safeDecode(body.slice(split + 1));
  return { route: `${HOME_ROUTE}${rawRoute.replace(/^\/+|\/+$/g, '')}`, anchor };
}

export function collectLinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const withoutCode = line.replace(/`[^`]*`/g, '');
    for (const match of withoutCode.matchAll(MARKDOWN_LINK)) targets.push(match[1]);
    for (const match of withoutCode.matchAll(HTML_REFERENCE)) targets.push(match[1]);
  }
  return targets;
}

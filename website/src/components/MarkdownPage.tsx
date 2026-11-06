import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { ComponentProps } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { hashFor, resolveLink } from '../lib/links';
import { findPageByFile, HOME_ROUTE } from '../lib/pages';
import { imageUrlFor } from '../lib/sources';

const LANGUAGES = { bash, css, diff, javascript, json, markdown, typescript, xml, yaml };
const LANGUAGE_PREFIX = 'language-';
const REPO_ONLY_HINT = 'Lives in the repository, not on this site';

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS: ComponentProps<typeof ReactMarkdown>['rehypePlugins'] = [
  rehypeRaw,
  rehypeSanitize,
  rehypeSlug,
  [rehypeHighlight, { detect: false, languages: LANGUAGES }],
];

const COMPONENTS_BY_FILE = new Map<string, Components>();

function createComponents(file: string): Components {
  const route = findPageByFile(file)?.route ?? HOME_ROUTE;
  return {
    a({ href, children }) {
      if (!href) return <>{children}</>;
      const link = resolveLink(file, href);
      switch (link.kind) {
        case 'external':
          return (
            <a href={link.href} rel="noopener noreferrer" target="_blank">
              {children}
            </a>
          );
        case 'anchor':
          return <a href={hashFor(route, link.anchor)}>{children}</a>;
        case 'page':
          return <a href={hashFor(link.route, link.anchor)}>{children}</a>;
        default:
          return (
            <span className="repo-ref" title={`${REPO_ONLY_HINT}: ${link.kind === 'repo' ? link.path : href}`}>
              {children}
            </span>
          );
      }
    },
    img({ src, alt, width, height }) {
      const link = src ? resolveLink(file, src) : null;
      const resolved = link?.kind === 'asset' ? imageUrlFor(link.path) : src;
      return <img src={resolved} alt={alt ?? ''} width={width} height={height} loading="lazy" />;
    },
    pre({ node, children }) {
      const language = codeLanguage(node);
      return (
        <figure className="code-sheet">
          {language && <figcaption className="code-language">{language}</figcaption>}
          <pre>{children}</pre>
        </figure>
      );
    },
    table({ children }) {
      return (
        <div className="table-scroll">
          <table>{children}</table>
        </div>
      );
    },
  };
}

type HastElement = NonNullable<ExtraProps['node']>;

function codeLanguage(node: HastElement | undefined): string | null {
  const code = node?.children.find((child): child is HastElement => child.type === 'element' && child.tagName === 'code');
  const classes = code?.properties.className;
  if (!Array.isArray(classes)) return null;
  const language = classes.map(String).find((name) => name.startsWith(LANGUAGE_PREFIX));
  return language ? language.slice(LANGUAGE_PREFIX.length) : null;
}

function componentsFor(file: string): Components {
  const cached = COMPONENTS_BY_FILE.get(file);
  if (cached) return cached;
  const created = createComponents(file);
  COMPONENTS_BY_FILE.set(file, created);
  return created;
}

type MarkdownPageProps = { file: string; source: string };

export function MarkdownPage({ file, source }: MarkdownPageProps) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      remarkRehypeOptions={{ allowDangerousHtml: true }}
      components={componentsFor(file)}
    >
      {source}
    </ReactMarkdown>
  );
}

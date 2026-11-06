import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { ThemeRegistration } from 'shiki/types';
import bash from 'shiki/dist/langs/shellscript.mjs';
import c from 'shiki/dist/langs/c.mjs';
import cpp from 'shiki/dist/langs/cpp.mjs';
import css from 'shiki/dist/langs/css.mjs';
import go from 'shiki/dist/langs/go.mjs';
import html from 'shiki/dist/langs/html.mjs';
import ini from 'shiki/dist/langs/ini.mjs';
import java from 'shiki/dist/langs/java.mjs';
import javascript from 'shiki/dist/langs/javascript.mjs';
import jsx from 'shiki/dist/langs/jsx.mjs';
import json from 'shiki/dist/langs/json.mjs';
import jsonc from 'shiki/dist/langs/jsonc.mjs';
import less from 'shiki/dist/langs/less.mjs';
import markdown from 'shiki/dist/langs/markdown.mjs';
import mdx from 'shiki/dist/langs/mdx.mjs';
import php from 'shiki/dist/langs/php.mjs';
import python from 'shiki/dist/langs/python.mjs';
import ruby from 'shiki/dist/langs/ruby.mjs';
import rust from 'shiki/dist/langs/rust.mjs';
import scss from 'shiki/dist/langs/scss.mjs';
import sql from 'shiki/dist/langs/sql.mjs';
import toml from 'shiki/dist/langs/toml.mjs';
import tsx from 'shiki/dist/langs/tsx.mjs';
import typescript from 'shiki/dist/langs/typescript.mjs';
import vue from 'shiki/dist/langs/vue.mjs';
import xml from 'shiki/dist/langs/xml.mjs';
import yaml from 'shiki/dist/langs/yaml.mjs';
import theme from '../themes/lantern-dark.json';

const languages = [bash, c, cpp, css, go, html, ini, java, javascript, jsx, json, jsonc, less, markdown, mdx, php, python, ruby, rust, scss, sql, toml, tsx, typescript, vue, xml, yaml].flat();

const highlighter = createHighlighterCoreSync({
  engine: createJavaScriptRegexEngine(),
  langs: languages,
  themes: [theme as unknown as ThemeRegistration],
});

function tokenStyle(token: { color?: string; bgColor?: string; fontStyle?: number; htmlStyle?: Record<string, string> }) {
  const style = { ...token.htmlStyle };
  if (!token.htmlStyle) {
    if (token.color) style.color = token.color;
    if (token.bgColor) style['background-color'] = token.bgColor;
    if (token.fontStyle && token.fontStyle & 1) style['font-style'] = 'italic';
    if (token.fontStyle && token.fontStyle & 2) style['font-weight'] = 'bold';
    const decorations = [];
    if (token.fontStyle && token.fontStyle & 4) decorations.push('underline');
    if (token.fontStyle && token.fontStyle & 8) decorations.push('line-through');
    if (decorations.length) style['text-decoration'] = decorations.join(' ');
  }
  return Object.entries(style).map(([name, value]) => `${name}:${value}`).join(';');
}

function highlightLines(text: string, lang: string) {
  return highlighter.codeToTokensBase(text, { lang, theme: theme.name }).map((line) => line.map((token) => {
    const style = tokenStyle(token);
    const content = token.content.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!);
    return style ? `<span style="${style}">${content}</span>` : content;
  }).join(''));
}

function hasLanguage(lang: string | null): lang is string {
  return !!lang && highlighter.getLoadedLanguages().includes(lang);
}

export { hasLanguage, highlightLines };

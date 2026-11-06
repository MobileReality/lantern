import { readFileSync } from 'node:fs';
import { OPTION } from './args.mjs';
import { SkillError } from './http.mjs';
import { message } from './messages.mjs';

const BLOCK_NAME = /^[a-z0-9][a-z0-9:_-]{0,63}$/;

export const BLOCK_OPTIONS = Object.freeze({ name: OPTION.value, file: OPTION.value });

const markers = (name) => ({ begin: `<!-- ${name} -->`, end: `<!-- /${name} -->` });

export function readBlock(options) {
  if (!options.name || !options.file) throw new SkillError(message('block.required'));
  if (!BLOCK_NAME.test(options.name)) throw new SkillError(message('block.badName', { name: options.name }));
  let content;
  try {
    content = readFileSync(options.file, 'utf8').trim();
  } catch (cause) {
    throw new SkillError(message('block.unreadable', { reason: cause.message }));
  }
  if (!content) throw new SkillError(message('block.empty'));
  return { name: options.name, content };
}

export function withBlock(description, { name, content }) {
  const { begin, end } = markers(name);
  const block = `${begin}\n\n${content}\n\n${end}`;
  const existing = description ?? '';
  const stop = existing.indexOf(end);
  const start = stop === -1 ? -1 : existing.lastIndexOf(begin, stop);
  if (start === -1) return `${existing.trimEnd()}\n\n${block}\n`;
  return `${existing.slice(0, start)}${block}${existing.slice(stop + end.length)}`;
}

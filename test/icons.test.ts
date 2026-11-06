// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS = path.resolve(__dirname, '../src/renderer/assets');
const svgs = (dir: string) => readdirSync(path.join(ASSETS, dir)).map((name) => [name, readFileSync(path.join(ASSETS, dir, name), 'utf8')]);

function parse(markup: string) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  expect(doc.documentElement.tagName).toBe('svg');
  expect(doc.documentElement.getAttribute('aria-hidden')).toBe('true');
  return doc.documentElement;
}

describe('shared icons', () => {
  it.each(svgs('icons'))('%s is one well-formed svg that screen readers skip', (_name, markup) => {
    expect(parse(markup).getAttribute('viewBox')).toBe('0 0 16 16');
  });

  it.each(svgs('logos'))('the %s mark is one well-formed svg that screen readers skip', (_name, markup) => {
    expect(parse(markup).getAttribute('viewBox')).toMatch(/^0 0 (16|24) (16|24)$/);
  });
});

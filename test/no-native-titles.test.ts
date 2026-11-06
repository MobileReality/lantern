// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = path.resolve(__dirname, '../src/renderer');
const NATIVE_TITLE = [/(?<![\w-])title="/, /(?<!document)\.title = /, /setAttribute\('title'/];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|html)$/.test(entry.name) ? [full] : [];
  });
}

describe('tooltips', () => {
  it('go through data-tip and the tooltip module, never the native title', () => {
    const offenders = sources(RENDERER).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (NATIVE_TITLE.some((rule) => rule.test(line)) ? [`${path.relative(RENDERER, file)}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  it('catches each way of setting a native title', () => {
    for (const line of ['<button title="x">', 'button.title = text;', "el.setAttribute('title', t)"]) expect(NATIVE_TITLE.some((rule) => rule.test(line)), line).toBe(true);
    for (const line of ['<button data-tip="x">', 'button.dataset.tip = text;', '<svg><title>x</title></svg>']) expect(NATIVE_TITLE.some((rule) => rule.test(line)), line).toBe(false);
  });
});

describe('buttons in the page', () => {
  it.each(['workspace.html', 'overlay.html'])('keep an accessible name of their own in %s, since a tooltip is not one', (page) => {
    const doc = new DOMParser().parseFromString(readFileSync(path.join(RENDERER, page), 'utf8'), 'text/html');
    const unnamed = [...doc.querySelectorAll('button')]
      .filter((button) => !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby') && !/\p{L}/u.test(button.textContent ?? ''))
      .map((button) => button.id || button.outerHTML.slice(0, 60));
    expect(unnamed).toEqual([]);
  });
});

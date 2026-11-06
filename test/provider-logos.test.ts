// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { providerLogo } from '@renderer/lib/provider-logo';
import { PROVIDER_IDS, PROVIDERS } from '@shared/providers';

const root = path.resolve(__dirname, '..');
const RENDERER_FOLDERS = ['src/renderer/lib', 'src/renderer/features'];

const rendererFiles = RENDERER_FOLDERS.flatMap((dir) =>
  readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `${dir}/${name}`),
);

describe('provider logos', () => {
  it('gives every provider id an inline svg logo', () => {
    const marks = PROVIDER_IDS.map((id) => providerLogo(id).innerHTML);
    for (const mark of marks) {
      expect(mark).toMatch(/^<svg [^>]*viewBox="[^"]+"[^>]*><path d="[^"]+"><\/path><\/svg>$/);
      expect(mark).toContain('currentColor');
      expect(mark).not.toMatch(/https?:|<image|href=/);
    }
    expect(new Set(marks).size).toBe(PROVIDER_IDS.length);
  });

  it('draws a hidden logo element for each provider', () => {
    for (const id of PROVIDER_IDS) {
      const logo = providerLogo(id);
      expect(logo.classList.contains(`prov-logo-${id}`)).toBe(true);
      expect(logo.querySelector('svg')).not.toBeNull();
      expect(logo.textContent).toBe('');
      expect(logo.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('keeps the table free of a letter mark and no screen draws one', () => {
    for (const id of PROVIDER_IDS) expect(Object.keys(PROVIDERS[id])).not.toContain('mark');
    const offenders = rendererFiles.filter((file) => /PROVIDERS\[[^\]]+\]\.mark\b|int-mark-\$\{/.test(readFileSync(path.join(root, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('draws provider marks only through providerLogo on the integrations screens', () => {
    const screens = rendererFiles.filter((file) => /integrations[\w-]*\.ts$/.test(file));
    expect(screens.length).toBeGreaterThan(5);
    const own = screens.filter((file) => /<svg|assets\/logos/.test(readFileSync(path.join(root, file), 'utf8')));
    expect(own).toEqual([]);
  });
});

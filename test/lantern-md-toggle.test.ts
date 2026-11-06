// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { openCodeModal } from '../src/renderer/lib/codemodal';

const flush = () => new Promise((r) => setTimeout(r, 0));
const read = (text: string) => async () => ({ exists: true, text, truncated: 0 });

function open(path: string, text: string, toggle: boolean) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  openCodeModal(host, read(text), path, '', undefined, undefined, undefined, toggle);
  return host;
}

afterEach(() => {
  document.body.textContent = '';
});

describe('markdown toggle in the code modal', () => {
  it('shows raw first and renders on click, sanitised', async () => {
    const host = open('docs/a.md', '# Title\n\n<script>alert(1)</script>', true);
    await flush();
    const toggle = host.querySelector('.lt-md-toggle') as HTMLButtonElement;
    expect(toggle.hidden).toBe(false);
    expect(host.querySelector('.lt-md')).toBeNull();
    toggle.click();
    expect(host.querySelector('.lt-md h1')?.textContent).toBe('Title');
    expect(host.querySelector('script')).toBeNull();
    toggle.click();
    expect(host.querySelector('.lt-md')).toBeNull();
    expect(host.querySelector('.lt-code-body')?.textContent).toContain('# Title');
  });

  it('is hidden for non-markdown files', async () => {
    const host = open('src/a.ts', 'const a = 1;', true);
    await flush();
    expect((host.querySelector('.lt-md-toggle') as HTMLButtonElement).hidden).toBe(true);
  });

  it('is hidden when the view does not enable it', async () => {
    const host = open('docs/a.md', '# T', false);
    await flush();
    expect((host.querySelector('.lt-md-toggle') as HTMLButtonElement).hidden).toBe(true);
  });
});

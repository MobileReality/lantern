import { describe, expect, it } from 'vitest';
import { classifyServerPage } from '../src/main/serveweb-parse';

const DOWNLOAD_BODY = 'The latest version of the Visual Studio Code Server is downloading, please wait a moment...<script>setTimeout(()=>location.reload(),1500)</script>';

describe('classifyServerPage', () => {
  it('recognises the serve-web download placeholder regardless of status', () => {
    expect(classifyServerPage(200, DOWNLOAD_BODY)).toBe('downloading');
    expect(classifyServerPage(503, DOWNLOAD_BODY)).toBe('downloading');
  });

  it('treats a 200 page that loads the workbench as ready', () => {
    expect(classifyServerPage(200, '<script src="/stable-abc/out/vs/code/browser/workbench/workbench.js"></script>')).toBe('workbench');
  });

  it('does not accept a workbench mention on an error status', () => {
    expect(classifyServerPage(502, 'workbench failed')).toBe('other');
  });

  it('reports anything else as other', () => {
    expect(classifyServerPage(200, '<html></html>')).toBe('other');
    expect(classifyServerPage(undefined, '')).toBe('other');
  });
});

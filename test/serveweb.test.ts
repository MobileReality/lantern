import { describe, expect, it } from 'vitest';
import { PREFERRED_PORT, classifyProgressLine, status } from '../src/main/serveweb';

describe('status', () => {
  it('reports the port and a not-yet-ready snapshot', () => {
    const s = status();
    expect(s.port).toBe(PREFERRED_PORT);
    expect(s.ready).toBe(false);
    expect(typeof s.available).toBe('boolean');
  });
});

describe('classifyProgressLine', () => {
  it('ignores blank lines and CLI banner lines', () => {
    expect(classifyProgressLine('')).toBeNull();
    expect(classifyProgressLine('   ')).toBeNull();
    expect(classifyProgressLine('* some banner')).toBeNull();
  });

  it('returns null for lines without a recognised keyword', () => {
    expect(classifyProgressLine('Reticulating splines')).toBeNull();
  });

  it('reads a download line and extracts the percentage', () => {
    expect(classifyProgressLine('Downloading VS Code server 42%')).toEqual({
      text: 'Downloading the VS Code server…',
      phase: 'download',
      percent: 42,
    });
  });

  it('maps unpack/extract/install lines to the install phase', () => {
    expect(classifyProgressLine('Unpacking server...')?.phase).toBe('install');
    expect(classifyProgressLine('Extracting files')?.phase).toBe('install');
    expect(classifyProgressLine('Installing dependencies')?.phase).toBe('install');
  });

  it('treats a listening/available line as fully started', () => {
    expect(classifyProgressLine('Web UI available at http://localhost')).toEqual({
      text: 'Server up — loading the editor…',
      phase: 'starting',
      percent: 100,
    });
  });

  it('caps an out-of-range percentage at 100', () => {
    expect(classifyProgressLine('downloading 250%')?.percent).toBe(100);
  });

  it('reports null percent when no number is present', () => {
    expect(classifyProgressLine('downloading server')?.percent).toBeNull();
  });
});

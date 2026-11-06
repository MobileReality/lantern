import { describe, expect, it } from 'vitest';
import { fileIconName } from '../src/renderer/lib/file-icons';

describe('material file icon lookup', () => {
  it('prefers exact filenames before compound and simple extensions', () => {
    expect(fileIconName('/repo/package.json')).toBe('nodejs');
    expect(fileIconName('/repo/component.spec.ts')).toBe('test-ts');
    expect(fileIconName('/repo/component.ts')).toBe('typescript');
  });

  it('normalizes case and separators', () => {
    expect(fileIconName('C:\\repo\\COMPONENT.TSX')).toBe('react_ts');
  });

  it('uses the generic icon for unknown, extensionless, and prototype names', () => {
    expect(fileIconName('README.unknown-lantern-extension')).toBe('file');
    expect(fileIconName('MakefileWithoutAssociation')).toBe('file');
    expect(fileIconName('constructor')).toBe('file');
  });
});

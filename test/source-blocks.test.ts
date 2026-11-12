import { describe, expect, it } from 'vitest';
import { callArguments, functionBody, ipcHandler } from './helpers/source-blocks';

describe('source-blocks bracket matching', () => {
  it('finds a plain function body', () => {
    const source = 'function run(a) { if (a) { return 1; } return 2; }\nconst after = 3;';
    expect(functionBody(source, 'run').text).toBe('{ if (a) { return 1; } return 2; }');
  });

  it('ignores braces inside single, double and template strings', () => {
    const source = [
      'function run() {',
      "  const open = '{';",
      '  const close = "}";',
      '  const both = `}{`;',
      '  return open + close + both;',
      '}',
      'const after = 1;',
    ].join('\n');
    expect(functionBody(source, 'run').text.endsWith('return open + close + both;\n}')).toBe(true);
  });

  it('ignores escaped quotes inside strings', () => {
    const source = "function run() { const s = 'it\\'s }'; return s; }\nconst after = 1;";
    expect(functionBody(source, 'run').text).toBe("{ const s = 'it\\'s }'; return s; }");
  });

  it('balances braces inside a template expression and ignores those in its text', () => {
    const source = 'function run(x) { return `}${x.map((i) => { return `{${i}`; })}{`; }\nconst after = 1;';
    expect(functionBody(source, 'run').text).toBe('{ return `}${x.map((i) => { return `{${i}`; })}{`; }');
  });

  it('ignores braces inside line and block comments', () => {
    const source = ['function run() {', '  // }', '  /* } { */', '  return 1;', '}', 'const after = 1;'].join('\n');
    expect(functionBody(source, 'run').text).toBe('{\n  // }\n  /* } { */\n  return 1;\n}');
  });

  it('keeps a quote inside a comment from opening a string', () => {
    const source = ["function run() {", "  // don't", '  return 1;', '}', 'const after = 1;'].join('\n');
    expect(functionBody(source, 'run').text.endsWith('return 1;\n}')).toBe(true);
  });

  it('applies to call arguments and ipc handlers too', () => {
    expect(callArguments("register(')', () => { /* ) */ });", 'register').text).toBe("(')', () => { /* ) */ })");
    const source = "ipcMain.handle('x:y', () => { return '})'; });\nconst after = 1;";
    expect(ipcHandler(source, 'x:y').text).toBe("('x:y', () => { return '})'; })");
  });

  it('still reports an unbalanced block', () => {
    expect(() => functionBody('function run() { return 1;', 'run')).toThrow(/unbalanced/);
  });
});

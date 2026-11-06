import { describe, expect, it } from 'vitest';
import { classifyListener, descendantsOf, isServeWebCommand, parsePsTable } from '../src/main/proctree';

const LANTERN = 500;
const APP = '/Applications/Visual Studio Code.app/Contents';
const ARGS = 'serve-web --port 9888 --without-connection-token --accept-server-license-terms';

const table = (lanternOf: number) => `
  ${LANTERN}     1 S    /Applications/Lantern.app/Contents/MacOS/Lantern
  700 ${lanternOf} S    bash ${APP}/Resources/app/bin/code ${ARGS}
  701   700 S    ${APP}/MacOS/Code ${APP}/Resources/app/out/cli.js ${ARGS}
  702   701 S    ${APP}/Resources/app/bin/code-tunnel ${ARGS}
  703   702 S    bash /Users/me/.vscode/cli/serve-web/abc/bin/code-server --socket-path /tmp/x
  704   703 S    /Users/me/.vscode/cli/serve-web/abc/node /Users/me/.vscode/cli/serve-web/abc/out/server-main.js
  705   704 S    /Users/me/.vscode/cli/serve-web/abc/node extensionHost
  706   704 Z    (node)
  900     1 S    /usr/sbin/unrelated --port 9888
`;

describe('parsePsTable', () => {
  it('reads pid, ppid, stat and the full command, skipping blanks', () => {
    const rows = parsePsTable(table(LANTERN));
    expect(rows).toHaveLength(9);
    expect(rows[1]).toEqual({ pid: 700, ppid: LANTERN, stat: 'S', command: `bash ${APP}/Resources/app/bin/code ${ARGS}` });
    expect(rows[7].stat).toBe('Z');
  });

  it('ignores header and malformed lines', () => {
    expect(parsePsTable('  PID  PPID STAT COMMAND\ngarbage\n 12 1 S sh')).toEqual([{ pid: 12, ppid: 1, stat: 'S', command: 'sh' }]);
  });
});

describe('descendantsOf', () => {
  it('collects the whole subtree, excluding the root', () => {
    const rows = parsePsTable(table(LANTERN));
    expect(descendantsOf(rows, 700).sort()).toEqual([701, 702, 703, 704, 705, 706]);
    expect(descendantsOf(rows, 704).sort()).toEqual([705, 706]);
  });

  it('returns nothing for a leaf or unknown pid', () => {
    const rows = parsePsTable(table(LANTERN));
    expect(descendantsOf(rows, 705)).toEqual([]);
    expect(descendantsOf(rows, 12345)).toEqual([]);
  });

  it('survives a ppid cycle', () => {
    const rows = parsePsTable('10 11 S a\n11 10 S b\n12 12 S c');
    expect(descendantsOf(rows, 10)).toEqual([11]);
  });
});

describe('isServeWebCommand', () => {
  it('matches the wrapper, the Electron CLI and code-tunnel', () => {
    for (const r of parsePsTable(table(LANTERN)).filter((r) => r.pid >= 700 && r.pid <= 702)) expect(isServeWebCommand(r.command)).toBe(true);
    expect(isServeWebCommand('C:\\VS Code\\bin\\code.cmd serve-web --port 9888')).toBe(true);
    expect(isServeWebCommand('code-insiders serve-web')).toBe(true);
  });

  it('rejects the desktop app, other tools and lookalike args', () => {
    expect(isServeWebCommand(`${APP}/MacOS/Code`)).toBe(false);
    expect(isServeWebCommand(`${APP}/MacOS/Code ${APP}/Resources/app/out/cli.js --folder serve-web-notes`)).toBe(false);
    expect(isServeWebCommand('/usr/sbin/unrelated --port 9888')).toBe(false);
    expect(isServeWebCommand('vim serve-web.txt')).toBe(false);
  });
});

const COMMIT = '6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1';
const STORE = `/Users/me/.vscode/cli/serve-web/${COMMIT}`;
const DIRECT_ARGS = '--host 127.0.0.1 --port 9888 --without-connection-token --accept-server-license-terms --reconnection-grace-time 60';

describe('a directly launched server', () => {
  it('is recognised by its wrapper and by the node process, but only with a port', () => {
    expect(isServeWebCommand(`bash ${STORE}/bin/code-server ${DIRECT_ARGS}`)).toBe(true);
    expect(isServeWebCommand(`${STORE}/node ${STORE}/out/server-main.js ${DIRECT_ARGS}`)).toBe(true);
    expect(isServeWebCommand(`${STORE}/node ${STORE}/out/server-main.js --socket-path /tmp/x`)).toBe(false);
    expect(isServeWebCommand(`${STORE}/node ${STORE}/out/bootstrap-fork --type=extensionHost`)).toBe(false);
  });

  it('is stale when a leftover one holds the port, rooted at its wrapper', () => {
    const rows = parsePsTable(`
      800     1 S    bash ${STORE}/bin/code-server ${DIRECT_ARGS}
      801   800 S    ${STORE}/node ${STORE}/out/server-main.js ${DIRECT_ARGS}
    `);
    expect(classifyListener(rows, 801, LANTERN)).toEqual({ kind: 'stale', root: 800 });
  });

  it('is own when this Lantern started it', () => {
    const rows = parsePsTable(`
      ${LANTERN}     1 S    /Applications/Lantern.app/Contents/MacOS/Lantern
      800 ${LANTERN} S    bash ${STORE}/bin/code-server ${DIRECT_ARGS}
      801   800 S    ${STORE}/node ${STORE}/out/server-main.js ${DIRECT_ARGS}
    `);
    expect(classifyListener(rows, 801, LANTERN)).toEqual({ kind: 'own' });
  });
});

describe('classifyListener', () => {
  it('is none when nothing listens', () => {
    expect(classifyListener(parsePsTable(table(LANTERN)), null, LANTERN)).toEqual({ kind: 'none' });
  });

  it('is own when the listener descends from this process', () => {
    expect(classifyListener(parsePsTable(table(LANTERN)), 702, LANTERN)).toEqual({ kind: 'own' });
  });

  it('is stale when an orphaned serve-web holds the port, rooted at the topmost wrapper', () => {
    expect(classifyListener(parsePsTable(table(1)), 702, LANTERN)).toEqual({ kind: 'stale', root: 700 });
  });

  it('is foreign when another running Lantern owns the serve-web, so a dev build never kills it', () => {
    const other = 600;
    const rows = parsePsTable(`${table(other)}\n  ${other} 1 S /Applications/Lantern.app/Contents/MacOS/Lantern`);
    expect(classifyListener(rows, 702, LANTERN)).toEqual({ kind: 'foreign' });
  });

  it('is stale when the serve-web outlived the Lantern that launched it', () => {
    expect(classifyListener(parsePsTable(table(600)), 702, LANTERN)).toEqual({ kind: 'stale', root: 700 });
  });

  it('roots at the listener itself when its launcher already died', () => {
    const rows = parsePsTable(table(1)).filter((r) => r.pid !== 700 && r.pid !== 701);
    expect(classifyListener(rows, 702, LANTERN)).toEqual({ kind: 'stale', root: 702 });
  });

  it('is foreign for a listener that is not serve-web', () => {
    expect(classifyListener(parsePsTable(table(1)), 900, LANTERN)).toEqual({ kind: 'foreign' });
  });

  it('is none when the listener exited before the process snapshot', () => {
    expect(classifyListener(parsePsTable(table(1)), 4242, LANTERN)).toEqual({ kind: 'none' });
    expect(classifyListener([], 4242, LANTERN)).toEqual({ kind: 'none' });
  });
});

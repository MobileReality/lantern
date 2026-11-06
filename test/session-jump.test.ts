import { describe, expect, it } from 'vitest';
import { appForTty } from '../src/main/session-jump';
import { kittyWindowFor } from '../src/main/session-jump/integrations/kitty';
import { tmuxTarget } from '../src/main/session-jump/integrations/tmux';

describe('tmuxTarget', () => {
  const line = 'claude --resume TERM_PROGRAM=tmux TMUX=/private/tmp/tmux-501/default,26871,7 TMUX_PANE=%28 PATH=/repo/node_modules/.bin:/usr/bin';

  it('reads the socket and pane from the env and takes tmux from a fixed location, never the PATH', () => {
    expect(tmuxTarget(line, (f) => f === '/usr/local/bin/tmux')).toEqual({ socket: '/private/tmp/tmux-501/default', pane: '%28', bin: '/usr/local/bin/tmux' });
  });

  it('is null outside tmux or without a tmux binary', () => {
    expect(tmuxTarget('claude PATH=/usr/bin', () => true)).toBeNull();
    expect(tmuxTarget(line, () => false)).toBeNull();
  });
});

describe('appForTty', () => {
  const rows = [
    { pid: 10, ppid: 1, stat: 'S', command: '/Applications/Ghostty.app/Contents/MacOS/ghostty' },
    { pid: 20, ppid: 10, stat: 'S', command: '/usr/bin/login' },
    { pid: 30, ppid: 20, stat: 'S', command: '-zsh' },
    { pid: 40, ppid: 30, stat: 'S', command: 'tmux' },
    { pid: 50, ppid: 1, stat: 'S', command: 'orphan' },
    { pid: 60, ppid: 1, stat: 'S', command: '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper' },
    { pid: 70, ppid: 60, stat: 'S', command: '/bin/zsh' },
    { pid: 80, ppid: 1, stat: 'S', command: '/Users/me/Library/Application Support/iTerm2/iTermServer-3.6.4' },
    { pid: 90, ppid: 80, stat: 'S', command: '-zsh' },
    { pid: 100, ppid: 1, stat: 'S', command: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel' },
    { pid: 110, ppid: 100, stat: 'S', command: '/Users/me/.vscode/cli/serve-web/2c33b50b16c472efe58357d1d2a8a5414bc23fbf/node' },
    { pid: 120, ppid: 110, stat: 'S', command: '/bin/zsh' },
  ];

  it('climbs from a process on the tty to the terminal app bundle', () => {
    expect(appForTty(rows, [50, 40])).toBe('/Applications/Ghostty.app');
  });

  it('takes the outermost bundle, so an editor terminal is the editor and not its helper', () => {
    expect(appForTty(rows, [70])).toBe('/Applications/Visual Studio Code.app');
  });

  it('takes a shell under the iTerm2 server daemon as iTerm', () => {
    expect(appForTty(rows, [90])).toBe('/Applications/iTerm.app');
  });

  it('is null for a terminal of the embedded editor, never the VS Code that launched its server', () => {
    expect(appForTty(rows, [120])).toBeNull();
  });

  it('is null when no ancestor is an app', () => {
    expect(appForTty(rows, [50])).toBeNull();
  });
});

describe('kittyWindowFor', () => {
  const ls = [{ tabs: [{ windows: [{ id: 1, pid: 100 }, { id: 2, pid: 200, foreground_processes: [{ pid: 300 }] }] }] }];

  it('finds the window running a process on the tty', () => {
    expect(kittyWindowFor(ls, [300])).toBe(2);
    expect(kittyWindowFor(ls, [100])).toBe(1);
  });

  it('is null for no match or a malformed listing', () => {
    expect(kittyWindowFor(ls, [999])).toBeNull();
    expect(kittyWindowFor({}, [100])).toBeNull();
  });
});

import type { MemoryCategory, MemoryKind } from '../shared/memory';

export interface ProcessIdentity {
  category: MemoryCategory;
  kind: MemoryKind;
  name: string;
  label: string;
}

export interface ProcessPosition {
  pid: number;
  ppid: number;
  rootPid: number;
}

const MAX_LABEL_LENGTH = 32;
const SAFE_TOKEN = /^[\w@./+-]+$/;
const INTERPRETERS = new Set(['node', 'nodejs', 'bun', 'deno', 'python', 'python3', 'ruby', 'npm', 'npx', 'pnpm', 'yarn']);
const RUNNER_VERBS = new Set(['exec', 'run', 'dlx', 'x', 'start']);
const INLINE_CODE_FLAGS = new Set(['-e', '-p', '-c', '--eval', '--print']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash']);

const ELECTRON_HELPER = /\bHelper[^/\\]*\.app[\\/]Contents[\\/]MacOS[\\/]/;
const ELECTRON_TYPE = /--type=(renderer|gpu-process|utility)\b/;
const CLAUDE_PACKAGE = /@anthropic-ai[\\/]claude-code[\\/]/;
const EXTENSION_FOLDER = /[\\/]extensions[\\/]([^\\/]+)[\\/]/;
const EXTENSION_VERSION = /-\d+(\.\d+)+.*$/;
const TSSERVER = /[\\/](tsserver|typingsInstaller)(\.js)?(\s|$)/;
const EDITOR_SERVER = /serve-web|code-tunnel|Visual Studio Code\.app|[\\/]\.vscode[\\/]cli[\\/]|server-main|[\\/]\.vscode-server[\\/]/;
const TEST_RUN = /\b(jest|vitest|playwright|mocha|cypress|pytest)\b/;
const DEV_SERVER = /(?:^|[\s/\\])(?:vite|webpack-dev-server|nodemon|storybook|ts-node-dev)(?:\.js)?(?:\s|$)|(?:^|[\s/\\])next\s+dev\b|\bwebpack\s+serve\b|\breact-scripts\s+start\b|\bexpo\s+start\b|\bnuxt\s+dev\b|\bastro\s+dev\b|\btsx\s+watch\b/;

const NAMES: Record<MemoryKind, string> = {
  main: 'Lantern app',
  renderer: 'Window renderer',
  gpu: 'GPU process',
  utility: 'Utility process',
  server: 'VS Code server',
  'extension-host': 'Extension host',
  tsserver: 'TypeScript server',
  watcher: 'File watcher',
  'pty-host': 'Terminal host',
  'agent-host': 'Agent host',
  extension: 'Extension process',
  claude: 'Claude agent',
  codex: 'Codex agent',
  test: 'Test run',
  'dev-server': 'Dev server',
  git: 'Git',
  shell: 'Shell',
  node: 'Node process',
  other: 'Process',
};

const baseName = (token: string) => token.split(/[\\/]/).filter(Boolean).pop() ?? token;
const executableName = (command: string) => baseName(command.split(/\s+/)[0] ?? '').replace(/^-/, '');
const clip = (text: string) => text.slice(0, MAX_LABEL_LENGTH);
const identity = (category: MemoryCategory, kind: MemoryKind, label: string): ProcessIdentity => ({ category, kind, name: NAMES[kind], label: clip(label) });

function genericLabel(command: string) {
  const tokens = command.split(/\s+/).filter(Boolean);
  const exe = executableName(command);
  if (!INTERPRETERS.has(exe)) return SAFE_TOKEN.test(exe) ? exe : 'process';
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (INLINE_CODE_FLAGS.has(token)) return exe;
    if (token.startsWith('-') || RUNNER_VERBS.has(token)) continue;
    return SAFE_TOKEN.test(token) ? baseName(token) : exe;
  }
  return exe;
}

function appKind(command: string, { pid, ppid, rootPid }: ProcessPosition) {
  if (pid === rootPid) return identity('app', 'main', 'main');
  if (ppid !== rootPid || !ELECTRON_HELPER.test(command)) return null;
  const type = ELECTRON_TYPE.exec(command)?.[1];
  if (type === 'renderer') return identity('app', 'renderer', 'renderer');
  if (type === 'gpu-process') return identity('app', 'gpu', 'gpu');
  return identity('app', 'utility', 'utility');
}

function agentKind(command: string) {
  const exe = executableName(command);
  if (exe === 'claude' || CLAUDE_PACKAGE.test(command)) return identity('agents', 'claude', 'claude');
  if (exe.startsWith('codex')) return identity('agents', 'codex', 'codex');
  return null;
}

function extensionLabel(command: string) {
  const folder = EXTENSION_FOLDER.exec(command)?.[1];
  return folder ? folder.replace(EXTENSION_VERSION, '') : null;
}

function serverLabel(command: string) {
  if (/code-tunnel/.test(command)) return 'code-tunnel';
  if (/server-main|code-server/.test(command)) return 'server-main';
  if (/copilot-runtime/.test(command)) return 'copilot-runtime';
  return 'code';
}

function editorKind(command: string) {
  const hostType = /--type=(extensionHost|fileWatcher|ptyHost|agentHost)\b/.exec(command)?.[1];
  if (hostType === 'extensionHost') return identity('editor', 'extension-host', 'extensionHost');
  if (hostType === 'fileWatcher') return identity('editor', 'watcher', 'fileWatcher');
  if (hostType === 'ptyHost') return identity('editor', 'pty-host', 'ptyHost');
  if (hostType === 'agentHost') return identity('editor', 'agent-host', 'agentHost');
  const tsserver = TSSERVER.exec(command);
  if (tsserver) return identity('editor', 'tsserver', `${tsserver[1]}.js`);
  const extension = extensionLabel(command);
  if (extension) return identity('editor', 'extension', extension);
  if (EDITOR_SERVER.test(command)) return identity('editor', 'server', serverLabel(command));
  return null;
}

function otherKind(command: string) {
  const label = genericLabel(command);
  const exe = executableName(command);
  if (exe === 'git') return identity('other', 'git', label);
  if (SHELLS.has(exe)) return identity('other', 'shell', label);
  if (TEST_RUN.test(command)) return identity('other', 'test', label);
  if (DEV_SERVER.test(command)) return identity('other', 'dev-server', label);
  if (exe === 'node' || exe === 'nodejs') return identity('other', 'node', label);
  return identity('other', 'other', label);
}

export function classifyProcess(command: string, position: ProcessPosition): ProcessIdentity {
  return appKind(command, position) ?? agentKind(command) ?? editorKind(command) ?? otherKind(command);
}

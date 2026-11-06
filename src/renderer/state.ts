// Shared renderer state. Tabs/sidebar (workspace.ts) own the mutations; features
// only read the current project via activeProjectPath().

import type { Provider } from '@main/provider';
import type { TabPhase } from './lib/editorload';

export interface EditorWatch {
  cover: HTMLElement;
  phase(): TabPhase;
  dispose(): void;
}

export interface ServerInfo {
  port: number;
  token: string;
  ready: boolean;
  available: boolean;
  progress?: string;
  phase?: string;
  percent?: number | null;
  graceSeconds?: number | null;
}

export interface Tab {
  webview: any;
  watch: EditorWatch;
  path: string | null;
  label: string;
  lastSelectedAt?: number;
}

export interface ProjectGroup {
  name: string;
  path: string;
  sessions: { state: string; provider?: Provider }[];
}

export const app = {
  info: { port: 9888, ready: false, available: true } as ServerInfo,
  groups: [] as ProjectGroup[],
  opened: new Map<string, Tab>(),
  activeKey: null as string | null,
  blankCounter: 0,
  pending: null as (() => void) | null,
  editorWanted: false,
  lanternFront: new Set<string>(),
  lanternPlatform: new Map<string, string>(),
  lanternLang: new Map<string, string>(),
  lanternSection: new Map<string, string>(),
  explainCollapsed: new Map<string, boolean>(),
  lanternPr: new Map<string, string>(),
  dismissedPrs: new Map<string, string[]>(),
};

export function activeProjectPath(): string | null {
  return app.activeKey && !app.activeKey.startsWith('blank:') ? app.activeKey : null;
}

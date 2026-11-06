import type { ServerInfo } from './state';
import type { DevInstance } from '../main/dev-instance';
import type { LanternCoverage, LanternMap, LanternPrOverlay } from '../main/lantern';
import type { ProjectFile } from '../main/filecontent';
import type { PrFileDiff } from '../main/lantern-prdiff';
import type { PrSides } from '../main/lantern-pr-revisions';
import type { PrFile } from '../main/lantern-prfile';
import type { NotificationCard } from '../main/session-notification';
import type { CardPrefs } from '../main/overlay';
import type { CompareCommit, CompareRefs, CompareStat } from '../shared/local-review';
import type { LocalReasonsResult } from '../main/local-reasons';
import type { MacroLoad } from '../main/lantern-macro-load';
import type { SetupProgress } from '../main/setup-progress';
import type { CliStatus } from '../main/cli';
import type { ExtensionsPanel } from '../main/extensions';
import type { RtkStatus } from '../shared/rtk';
import type { Provider } from '../main/provider';
import type { SemanticHighlightRequest, SemanticHighlightResult } from '../shared/code-highlighting';
import type { SettingKey, SettingsChange, SettingsSnapshot, SettingsUpdateResult } from '../shared/settings-registry';
import type { FreeMemoryResult, MemorySnapshot, MemoryViewState } from '../shared/memory';
import type { AddTokenResult, AuthChange, AuthReply, EditResult, ProjectReply } from '@shared/auth-view';
import type { ProviderId } from '@shared/providers';
import type { PrExplainDone, PrExplainSavedResult, PrExplainStartResult } from '../shared/pr-explain';
import type { TrayModel } from '../shared/tray-model';

export {};

interface ProjectGroupDto {
  name: string;
  path: string;
  sessions: { state: string; provider?: ToolsProvider }[];
}

interface CcmwsBridge {
  info(): Promise<any>;
  devInstance(): Promise<DevInstance | null>;
  restartEditor(): Promise<ServerInfo>;
  needEditor(): Promise<ServerInfo>;
  projects(): Promise<ProjectGroupDto[]>;
  addFolder(): Promise<{ groups: ProjectGroupDto[]; selectedPath: string | null }>;
  addPath(dir: string): Promise<ProjectGroupDto[]>;
  opened(path: string, name: string): void;
  hide(dir: string): Promise<ProjectGroupDto[]>;
  onProjects(cb: (list: ProjectGroupDto[]) => void): void;
  onInfo(cb: (info: any) => void): void;
  onOpen(cb: (cwd: string, project: string) => void): void;
  onShowCompare(cb: (project: string, id: string) => void): void;
  cliStatus(): Promise<CliStatus | null>;
  cliInstall(): Promise<CliStatus | null>;
  rtkStatus(project: string | null): Promise<RtkStatus>;
  skillsList(project: string | null): Promise<any>;
  skillsLink(project: string, names: string[]): Promise<any>;
  skillsUnlink(project: string, names: string[]): Promise<any>;
  extensionsLoad(project: string | null): Promise<ExtensionsPanel>;
  extensionsSave(project: string | null, slot: string, names: string[], off?: string[], scope?: string): Promise<ExtensionsPanel>;
  extensionsMove(project: string | null, slot: string, name: string, from: string, to: string): Promise<ExtensionsPanel>;
  extensionsCreate(project: string | null, slot: string, name: string, content: string, scope?: string): Promise<ExtensionsPanel>;
  extensionsSkillLinker(project: string | null, value: string | null): Promise<ExtensionsPanel>;
  extensionsImport(project: string | null): Promise<ExtensionsPanel>;
  skillsChooseDir(): Promise<string | null>;
  skillsClone(dir: string, remote?: string): Promise<{ ok: boolean; error?: string }>;
  skillsSync(): Promise<{ ok: boolean; error?: string }>;
  skillsReveal(): Promise<void>;
  fixMic(): Promise<boolean>;
  projectReadFile(project: string, file: string): Promise<ProjectFile>;
  projectIdent(project: string): Promise<import('../shared/project-ident').ProjectIdent>;
  semanticHighlight(request: SemanticHighlightRequest): Promise<SemanticHighlightResult>;
  lanternPrFile(project: string, pr: string, file: string): Promise<PrFile>;
  lanternPrFileDiff(project: string, pr: string, file: string, sides?: PrSides): Promise<PrFileDiff>;
  lanternPrOverlay(project: string, pr: string, lang?: string): Promise<LanternPrOverlay>;
  explainsList(project: string): Promise<MetaFileDto[]>;
  explainsRemove(project: string, name: string): Promise<MetaFileDto[]>;
  lanternLoad(project: string, lang?: string, fresh?: boolean): Promise<LanternMap>;
  lanternCoverage(project: string, fresh?: boolean): Promise<LanternCoverage>;
  lanternStamp(project: string): Promise<string>;
  lanternProgress(project: string, mode?: 'live' | 'fresh'): Promise<{ progress: SetupProgress | null; unfinished: 'lantern' | 'lantern-refresh' | null }>;
  lanternCount(project: string): Promise<number>;
  lanternFetchPrs(project: string, force?: boolean): Promise<{ ok: boolean; error?: string }>;
  lanternRefreshPrs(project: string): Promise<{ ok: boolean; error?: string }>;
  lanternEnterPr(project: string, pr: string): Promise<{ changed: boolean }>;
  lanternCompareRefs(project: string): Promise<CompareRefs>;
  lanternCompareCommits(project: string, ref: string): Promise<CompareCommit[]>;
  lanternCompareStat(project: string, base: string, head: string): Promise<CompareStat>;
  lanternLocalReasons(project: string, id: string): Promise<LocalReasonsResult>;
  lanternMacro(project: string, lang?: string): Promise<MacroLoad>;
  settingsGet(): Promise<AppSettings>;
  settingsProvider(project: string): Promise<ToolsProvider>;
  settingsDismissPr(project: string, id: string): Promise<AppSettings>;
  settingsRestorePrs(project: string): Promise<AppSettings>;
  settingsAddLocalReview(project: string, id: string): Promise<AppSettings>;
  settingsRemoveLocalReview(project: string, id: string): Promise<AppSettings>;
  settingsSnapshot(): Promise<SettingsSnapshot>;
  settingsUpdate(key: SettingKey, value: unknown): Promise<SettingsUpdateResult>;
  settingsOpenFile(): Promise<string>;
  onSettingsChanged(cb: (change: SettingsChange) => void): void;
  onCommand(cb: (id: string) => void): void;
  settingsSetProvider(project: string, provider: ToolsProvider): Promise<AppSettings>;
  onProvider(cb: (value: { project: string; provider: ToolsProvider }) => void): void;
  codexHooksStatus(): Promise<CodexHooksResult>;
  codexHooksInstall(): Promise<CodexHooksResult>;
  codexHooksUninstall?(): Promise<CodexHooksResult>;
  prExplainSaved(project: string, pr: string, path: string, head: string): Promise<PrExplainSavedResult>;
  prExplainStart(project: string, pr: string, path: string): Promise<PrExplainStartResult>;
  prExplainCancel(project: string, pr: string, path: string): Promise<boolean>;
  onPrExplainDone(cb: (done: PrExplainDone) => void): void;
  agentRun(project: string, kind: 'plan-fix' | 'lantern' | 'lantern-refresh', target?: string): Promise<{ ok: boolean; error?: string; resumed?: boolean; runId?: number; provider?: ToolsProvider }>;
  agentCancel(): Promise<boolean>;
  agentStatus(project: string | null): Promise<{ running: boolean; available: boolean; provider: ToolsProvider }>;
  onAgentEvent(cb: (event: AgentEvent) => void): void;
  onAgentStatus(cb: (status: { running: boolean }) => void): void;
  popoutOpen(tool: string, project: string): Promise<boolean>;
  authStatus(project?: string): Promise<AuthReply>;
  authProject(project: string): Promise<ProjectReply>;
  authAddToken(input: Record<string, unknown>): Promise<AddTokenResult>;
  authRenameProfile(profileId: string, nickname: string): Promise<EditResult>;
  authSetExpiry(profileId: string, expiresOn: string | null): Promise<EditResult>;
  authSetEmail(profileId: string, email: string | null): Promise<EditResult>;
  authBind(provider: ProviderId, profileId: string, project: string): Promise<AuthReply>;
  authUnbind(provider: ProviderId, project: string): Promise<AuthReply>;
  authRemoveProfile(profileId: string, project?: string): Promise<AuthReply>;
  onAuthChanged(cb: (change: AuthChange) => void): void;
  memoryWatch(on: boolean): Promise<MemoryViewState>;
  freeProjectMemory(project: string): Promise<FreeMemoryResult>;
  onMemoryUpdate(cb: (snapshot: MemorySnapshot) => void): void;
}

interface CodexHooksResult {
  ok: boolean;
  configured: boolean;
  changed?: boolean;
  configFile?: string;
  error?: string;
}

interface MetaFileDto {
  name: string;
  text: string;
  mtime: number;
}

interface AppSettings {
  languages: Record<string, string>;
  providers: Record<string, ToolsProvider>;
  dismissedPrs: Record<string, string[]>;
  setupUnfinished: Record<string, 'lantern' | 'lantern-refresh'>;
}

type ToolsProvider = Provider;

type OverlayCard = NotificationCard & { prefs: CardPrefs };

interface OverlayBridge {
  onCard(cb: (card: OverlayCard) => void): void;
  open(card: OverlayCard): void;
  jump(card: OverlayCard): void;
  resize(height: number): void;
  animate(direction: 'in' | 'out', still: boolean): void;
  setInteractive(on: boolean): void;
}

interface TrayPopoverBridge {
  onOpen(cb: (open: { model: TrayModel; maxHeight: number }) => void): void;
  onModel(cb: (model: TrayModel) => void): void;
  resize(height: number): void;
  close(): void;
  openProject(projectPath: string): void;
  run(id: string): void;
}

declare global {
  interface Window {
    ccmws: CcmwsBridge;
    overlay: OverlayBridge;
    trayPopover: TrayPopoverBridge;
  }
  interface AgentEvent {
    kind: 'start' | 'text' | 'tool' | 'done' | 'error' | 'cancelled';
    text?: string;
    tool?: string;
    detail?: string;
    ok?: boolean;
    costUsd?: number;
    durationMs?: number;
    denials?: number;
    runId?: number;
  }
}

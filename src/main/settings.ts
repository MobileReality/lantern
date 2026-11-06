import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { setConfiguredBin } from './agent';
import { isProvider } from './provider';
import { isLocalId } from '../shared/local-review';
import type { Provider } from './provider';

interface Settings {
  languages: Record<string, string>; // project path -> language
  providers?: Record<string, Provider>; // only once a project picks one
  dismissedPrs: Record<string, string[]>;
  localReviews: Record<string, string[]>;
  setupUnfinished: Record<string, SetupKind>; // project path -> the Lantern run that has not finished
  permissionConsent: Record<string, boolean>;
  serverLicenseAccepted: boolean; // the user accepted the Microsoft VS Code server licence
  claudeBin: string; // full path of the claude executable, for installs Lantern cannot find on its own
}

type SetupKind = 'lantern' | 'lantern-refresh';

const DEFAULTS: Settings = { languages: {}, dismissedPrs: {}, localReviews: {}, setupUnfinished: {}, permissionConsent: {}, serverLicenseAccepted: false, claudeBin: '' };

const STORED_KEYS = new Set<string>([...Object.keys(DEFAULTS), 'providers']);

const DISMISSED_MAX = 200;
const LOCAL_REVIEWS_MAX = 20;

let current: Settings = { ...DEFAULTS };

setConfiguredBin(() => (typeof current.claudeBin === 'string' ? current.claudeBin : ''));

function storeFile() {
  return path.join(app.getPath('userData'), 'ccm-settings.json');
}

function save() {
  try {
    fs.writeFileSync(storeFile(), `${JSON.stringify(current, null, 2)}\n`);
  } catch {}
}

function knownKeysOnly(stored: unknown): Partial<Settings> {
  if (!stored || typeof stored !== 'object') return {};
  return Object.fromEntries(Object.entries(stored).filter(([key]) => STORED_KEYS.has(key)));
}

function load() {
  try {
    current = { ...DEFAULTS, ...knownKeysOnly(JSON.parse(fs.readFileSync(storeFile(), 'utf8'))) };
  } catch {
    current = { ...DEFAULTS, languages: {}, dismissedPrs: {}, localReviews: {}, setupUnfinished: {}, permissionConsent: {}, serverLicenseAccepted: false, claudeBin: '' };
  }
  return all();
}

function all(): Settings {
  return { ...current, dismissedPrs: { ...current.dismissedPrs }, localReviews: { ...current.localReviews }, setupUnfinished: { ...current.setupUnfinished }, permissionConsent: { ...current.permissionConsent } };
}

function requestedLanguage(project: string): string | undefined {
  return (project && current.languages[project]) || undefined;
}

function provider(project: string): Provider {
  const chosen = project ? current.providers?.[project] : undefined;
  return isProvider(chosen) ? chosen : 'claude';
}

function setProvider(project: string, next: unknown) {
  if (!project || !isProvider(next)) return all();
  current.providers = { ...current.providers, [project]: next };
  save();
  return all();
}

function dismissPr(project: string, id: string) {
  if (!project || !/^\d+$/.test(id)) return all();
  const list = (current.dismissedPrs[project] ?? []).filter((x) => x !== id);
  current.dismissedPrs = { ...current.dismissedPrs, [project]: [...list, id].slice(-DISMISSED_MAX) };
  save();
  return all();
}

function restorePrs(project: string) {
  if (!project) return all();
  const { [project]: _gone, ...rest } = current.dismissedPrs;
  current.dismissedPrs = rest;
  save();
  return all();
}

function localReviews(project: string): string[] {
  const list = project ? current.localReviews?.[project] : undefined;
  return Array.isArray(list) ? list.filter(isLocalId).slice(-LOCAL_REVIEWS_MAX) : [];
}

function addLocalReview(project: string, id: string) {
  if (!project || !isLocalId(id)) return all();
  current.localReviews = { ...current.localReviews, [project]: [...localReviews(project).filter((x) => x !== id), id] };
  save();
  return all();
}

function removeLocalReview(project: string, id: string) {
  if (!project) return all();
  const list = localReviews(project).filter((x) => x !== id);
  const { [project]: _gone, ...rest } = current.localReviews ?? {};
  current.localReviews = list.length ? { ...rest, [project]: list } : rest;
  save();
  return all();
}

function setupUnfinished(project: string): SetupKind | null {
  const kind = current.setupUnfinished?.[project];
  return kind === 'lantern' || kind === 'lantern-refresh' ? kind : null;
}

function markSetup(project: string, kind: SetupKind | null) {
  if (!project || setupUnfinished(project) === kind) return;
  const { [project]: _gone, ...rest } = current.setupUnfinished ?? {};
  current.setupUnfinished = kind ? { ...rest, [project]: kind } : rest;
  save();
}

function permissionConsent(project: string): boolean | undefined {
  const answer = project ? current.permissionConsent?.[project] : undefined;
  return typeof answer === 'boolean' ? answer : undefined;
}

function setPermissionConsent(project: string, granted: boolean) {
  if (!project) return;
  current.permissionConsent = { ...current.permissionConsent, [project]: granted };
  save();
}

function serverLicenseAccepted(): boolean {
  return current.serverLicenseAccepted === true;
}

function acceptServerLicense() {
  current.serverLicenseAccepted = true;
  save();
}

export { serverLicenseAccepted, acceptServerLicense, permissionConsent, setPermissionConsent, load, all, setupUnfinished, markSetup, requestedLanguage, provider, setProvider, dismissPr, restorePrs, localReviews, addLocalReview, removeLocalReview };
export type { Settings, SetupKind };
